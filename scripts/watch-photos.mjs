import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import exifr from 'exifr';

const WATCH_DIR = './incoming';
const OUT_DIR = './optimised';
const LOG_FILE = './scripts/processed.json';

if (!fs.existsSync(WATCH_DIR)) fs.mkdirSync(WATCH_DIR);
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

function loadLog() {
    return fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8')) : {};
}

function saveLog(log) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function slugify(text) {
    return text.toString().toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-');
}

function getCleanTitle(meta, filename, ext) {
    const raw = meta?.title || meta?.Title || meta?.ObjectName || meta?.Headline;
    if (!raw) return filename.replace(ext, '');
    if (typeof raw === 'object' && raw !== null) {
        const val = raw.value || raw['x-default'] || Object.values(raw)[0];
        if (typeof val === 'string' && val.toLowerCase() !== 'x-default') return val.trim();
    }
    if (typeof raw === 'string' && raw.toLowerCase() !== 'x-default') return raw.trim();
    return filename.replace(ext, '');
}

async function getCountry(lat, lon) {
    if (!lat || !lon) return null;
    try {
        const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
        const data = await response.json();
        return data.countryName || null;
    } catch (e) { return null; }
}

console.log(`🚀 MONITORING: ${WATCH_DIR}`);

fs.watch(WATCH_DIR, async (eventType, filename) => {
    if (!filename || eventType !== 'rename') return;
    const ext = path.extname(filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) return;

    const inputPath = path.join(WATCH_DIR, filename);
    await new Promise(r => setTimeout(r, 2000));
    if (!fs.existsSync(inputPath)) return;

    const log = loadLog();
    if (log[filename]) return;

    try {
        const meta = await exifr.parse(inputPath, { xmp: true, iptc: true, mergeOutput: true });
        const gps = await exifr.gps(inputPath);

        const displayTitle = getCleanTitle(meta, filename, ext);
        const slug = slugify(displayTitle);

        // DATE LOGIC: Check if we actually have metadata date
        const hasMetaDate = !!meta?.DateTimeOriginal;
        const photoDate = hasMetaDate ? new Date(meta.DateTimeOriginal) : new Date();

        // Only create the string if metadata actually exists
        const shotDateString = hasMetaDate
            ? photoDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
            : null;

        const outputPath = path.join(OUT_DIR, `${slug}.webp`);
        const thumbPath = path.join(OUT_DIR, `${slug}-thumb.webp`);

        let buffer = fs.readFileSync(inputPath);
        if (ext === '.heic') buffer = await heicConvert({ buffer, format: 'JPEG', quality: 1 });

        await sharp(buffer).resize(2000, null, { withoutEnlargement: true }).webp({ quality: 85 }).toFile(outputPath);
        await sharp(buffer).resize(720, null, { withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumbPath);

        execSync(`npx wrangler r2 object put photoblog-media/${slug}.webp --file ${outputPath} --remote`, { stdio: 'inherit' });
        execSync(`npx wrangler r2 object put photoblog-media/${slug}-thumb.webp --file ${thumbPath} --remote`, { stdio: 'inherit' });

        const country = await getCountry(gps?.latitude, gps?.longitude);
        const blogDir = `./src/content/log/${photoDate.getFullYear()}/${String(photoDate.getMonth() + 1).padStart(2, '0')}`;
        if (!fs.existsSync(blogDir)) fs.mkdirSync(blogDir, { recursive: true });

        // Description only includes date prefix if metadata is present
        const description = shotDateString
            ? `${shotDateString}: ${displayTitle}${country ? ` in ${country}` : ''}`
            : `${displayTitle}${country ? ` in ${country}` : ''}`;

        const tags = ["Everything"];
        if (country) tags.push(country);

        const markdown = `---
title: "${displayTitle}"
description: "${description}"
pubDate: "${photoDate.toISOString()}"
heroImage: "https://media.asturcon.red/${slug}.webp"
thumbImage: "https://media.asturcon.red/${slug}-thumb.webp"
country: "${country || 'Unknown'}"
latitude: ${gps?.latitude || 'null'}
longitude: ${gps?.longitude || 'null'}
tags: ${JSON.stringify(tags)}
---

Xerum, quo qui aut unt expliquam qui dolut labo. Aque venitatiusda cum, voluptionse latur sitiae dolessi aut parist aut dollo enim qui voluptate ma dolestendit peritin re plis aut quas inctum laceat est volestemque commosa as cus endigna tectur? 

<small>${ shotDateString ? `**Shot on:** ${shotDateString}&nbsp;&nbsp;&nbsp;&nbsp;` : ''}${country ? `**Location:** ${country}` : ''}</small>
`;

        fs.writeFileSync(`${blogDir}/${slug}.md`, markdown);
        log[filename] = { date: photoDate.toISOString() };
        saveLog(log);

        const donePath = path.join(WATCH_DIR, 'done');
        if (!fs.existsSync(donePath)) fs.mkdirSync(donePath);
        fs.renameSync(inputPath, path.join(donePath, filename));

        console.log(`✅ Processed: ${slug}.md`);

    } catch (err) {
        console.error(`❌ Error:`, err.message);
    }
});