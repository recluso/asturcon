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
    if (fs.existsSync(LOG_FILE)) {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    }
    return {};
}

function saveLog(log) {
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function toTitleCase(name) {
    return name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

async function getGpsData(inputPath) {
    try {
        const gps = await exifr.gps(inputPath);
        return gps || { latitude: null, longitude: null };
    } catch (err) {
        console.warn(`⚠️ Could not extract GPS: ${err.message}`);
        return { latitude: null, longitude: null };
    }
}

async function getCountry(lat, lon) {
    if (!lat || !lon || (lat === 0 && lon === 0)) return null;

    try {
        const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
        const response = await fetch(url);
        const data = await response.json();
        return data.countryName || null;
    } catch (error) {
        console.error("⚠️ Geocoding lookup failed:", error.message);
        return null;
    }
}

async function createBlogPost(name, latitude, longitude) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const pubDate = now.toISOString();
    const title = toTitleCase(name);

    // 1. Fetch official name
    const rawCountry = await getCountry(latitude, longitude);

    // 2. Create the Pretty Name (strips legal suffixes)
    // Turns "United Kingdom of Great Britain..." into "United Kingdom"
    const prettyCountry = rawCountry
        ? rawCountry.split('(')[0].replace(/ of Great Britain.*/, '').trim()
        : null;

    const tags = ["Everything"];
    if (prettyCountry) {
        // Create a clean URL-friendly tag
        const countryTag = prettyCountry.toLowerCase().replace(/\s+/g, '-');
        tags.push(countryTag);
    }

    const friendlyDate = now.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    // 3. Use Pretty Name in description
    const description = `${friendlyDate} ${title}${prettyCountry ? ` in ${prettyCountry}` : ''}`;
    const blogDir = `./src/content/log/${year}/${month}`;
    const blogFile = `${blogDir}/${name}.md`;

    if (!fs.existsSync(blogDir)) fs.mkdirSync(blogDir, { recursive: true });

    // 4. Update the Markdown Template
    const markdown = `---
title: "${title}"
description: "${description}"
pubDate: "${pubDate}"
heroImage: "https://media.asturcon.red/${name}.webp"
thumbImage: "https://media.asturcon.red/${name}-thumb.webp"
latitude: ${latitude || 'null'}
longitude: ${longitude || 'null'}
country: "${prettyCountry || 'Unknown'}"
tags: ${JSON.stringify(tags)}
---

${prettyCountry ? `<p>🌍 <small><em>Location: ${prettyCountry}</em></small></p>` : ''}

Xerum, quo qui aut unt expliquam qui dolut labo. Aque venitatiusda cum, voluptionse latur sitiae dolessi aut parist aut dollo enim qui voluptate ma dolestendit peritin re plis aut quas inctum laceat est volestemque commosa as cus endigna tectur? 
`;

    fs.writeFileSync(blogFile, markdown);
    return { blogFile, year, month, name };
}

async function processImage(inputPath, name) {
    const ext = path.extname(inputPath).toLowerCase();
    const outputPath = path.join(OUT_DIR, `${name}.webp`);
    const thumbPath = path.join(OUT_DIR, `${name}-thumb.webp`);

    let inputBuffer;

    if (ext === '.heic' || ext === '.heif') {
        console.log(`🔄 Converting HEIC to JPEG first...`);
        const heicBuffer = fs.readFileSync(inputPath);
        const jpegBuffer = await heicConvert({
            buffer: heicBuffer,
            format: 'JPEG',
            quality: 1,
        });
        inputBuffer = Buffer.from(jpegBuffer);
    } else {
        inputBuffer = fs.readFileSync(inputPath);
    }

    await sharp(inputBuffer)
        .resize({ width: 2000, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(outputPath);

    console.log(`✓ Optimised: ${outputPath}`);

    await sharp(inputBuffer)
        .resize({ width: 720, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbPath);

    console.log(`✓ Thumbnail: ${thumbPath}`);

    return { outputPath, thumbPath };
}

console.log(`👀 Watching ${WATCH_DIR} for new images...`);

fs.watch(WATCH_DIR, async (eventType, filename) => {
    if (!filename) return;

    const ext = path.extname(filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(ext)) return;

    const inputPath = path.join(WATCH_DIR, filename);
    const name = path.basename(filename, ext).toLowerCase().replace(/\s+/g, '-');

    await new Promise(resolve => setTimeout(resolve, 500));

    if (!fs.existsSync(inputPath)) return;

    const log = loadLog();
    if (log[filename]) {
        console.log(`⏭️  Skipping ${filename} — already processed on ${log[filename].date}`);
        return;
    }

    console.log(`\n📷 Detected: ${filename}`);

    try {
        const gps = await getGpsData(inputPath);
        const { outputPath, thumbPath } = await processImage(inputPath, name);

        execSync(
            `npx wrangler r2 object put photoblog-media/${name}.webp --file ${outputPath} --remote`,
            { stdio: 'inherit' }
        );
        execSync(
            `npx wrangler r2 object put photoblog-media/${name}-thumb.webp --file ${thumbPath} --remote`,
            { stdio: 'inherit' }
        );

        log[filename] = {
            date: new Date().toISOString(),
            r2key: `${name}.webp`,
            r2thumb: `${name}-thumb.webp`,
        };
        saveLog(log);

        const doneDir = path.join(WATCH_DIR, 'done');
        if (!fs.existsSync(doneDir)) fs.mkdirSync(doneDir);
        fs.renameSync(inputPath, path.join(doneDir, filename));

        const { blogFile } = await createBlogPost(name, gps.latitude, gps.longitude);
        console.log(`✓ Created blog post: ${blogFile}`);

    } catch (err) {
        console.error(`✗ Failed to process ${filename}:`, err.message);
    }
});