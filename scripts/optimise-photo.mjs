import sharp from 'sharp';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import exifr from 'exifr';

const input = process.argv[2];
const manualName = process.argv[3];

if (!input) {
  console.error('Usage: node scripts/optimise-photo.mjs <input-file> [optional-name]');
  process.exit(1);
}

function slugify(text) {
  return text.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
}

function toTitleCase(str) {
  return str.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
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

async function run() {
  const ext = path.extname(input);
  const filename = path.basename(input);

  const meta = await exifr.parse(input, { xmp: true, iptc: true, mergeOutput: true }).catch(() => ({}));
  const gps = await exifr.gps(input).catch(() => null);

  const displayTitle = manualName ? toTitleCase(manualName) : getCleanTitle(meta, filename, ext);
  const slug = slugify(displayTitle);

  // DATE LOGIC
  const hasMetaDate = !!meta?.DateTimeOriginal;
  const photoDate = hasMetaDate ? new Date(meta.DateTimeOriginal) : new Date();
  const shotDateString = hasMetaDate
    ? photoDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const output = `./optimised/${slug}.webp`;
  const thumbOutput = `./optimised/${slug}-thumb.webp`;
  if (!fs.existsSync('./optimised')) fs.mkdirSync('./optimised');

  await sharp(input).resize(2000, null, { withoutEnlargement: true }).webp({ quality: 85 }).toFile(output);
  await sharp(input).resize(720, null, { withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumbOutput);

  execSync(`npx wrangler r2 object put photoblog-media/${slug}.webp --file ${output} --remote`, { stdio: 'inherit' });
  execSync(`npx wrangler r2 object put photoblog-media/${slug}-thumb.webp --file ${thumbOutput} --remote`, { stdio: 'inherit' });

  const country = await getCountry(gps?.latitude, gps?.longitude);
  const blogDir = `./src/content/log/${photoDate.getFullYear()}/${String(photoDate.getMonth() + 1).padStart(2, '0')}`;
  if (!fs.existsSync(blogDir)) fs.mkdirSync(blogDir, { recursive: true });

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
  console.log(`✅ Saved: ${slug}.md`);
}

run();