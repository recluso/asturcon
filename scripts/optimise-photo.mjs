import sharp from 'sharp';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import exifr from 'exifr';

const input = process.argv[2];
const name = process.argv[3];

if (!input || !name) {
  console.error('Usage: node scripts/optimise-photo.mjs <input-file> <output-name>');
  process.exit(1);
}

if (!fs.existsSync('./optimised')) fs.mkdirSync('./optimised');

const output = `./optimised/${name}.webp`;
const thumbOutput = `./optimised/${name}-thumb.webp`;

// --- HELPER FUNCTION: Reverse Geocode Coordinates ---
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

let latitude = null;
let longitude = null;

try {
  const gps = await exifr.gps(input);
  if (gps) {
    latitude = gps.latitude;
    longitude = gps.longitude;
    console.log(`📍 Found GPS: ${latitude}, ${longitude}`);
  }
} catch (e) {
  console.warn('⚠️ Could not extract GPS data.');
}

// 1. Fetch the raw country name
const rawCountry = await getCountry(latitude, longitude);

// 2. Create the Pretty Name (strips legal suffixes and (the) endings)
// This turns "United Kingdom of Great Britain and Northern Ireland (the)" into "United Kingdom"
const prettyCountry = rawCountry
  ? rawCountry.split('(')[0].replace(/ of Great Britain.*/, '').trim()
  : null;

// Process the images
await sharp(input)
  .resize({ width: 2000, withoutEnlargement: true })
  .webp({ quality: 85 })
  .toFile(output);

console.log(`✓ Optimised: ${output}`);

await sharp(input)
  .resize({ width: 720, withoutEnlargement: true })
  .webp({ quality: 80 })
  .toFile(thumbOutput);

console.log(`✓ Thumbnail: ${thumbOutput}`);

// Upload to R2
execSync(`npx wrangler r2 object put photoblog-media/${name}.webp --file ${output} --remote`, {
  stdio: 'inherit'
});
execSync(`npx wrangler r2 object put photoblog-media/${name}-thumb.webp --file ${thumbOutput} --remote`, {
  stdio: 'inherit'
});

// Prepare Metadata for Markdown
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const pubDate = now.toISOString();

const title = name
  .split('-')
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

// 3. Build the tags array using the Pretty Name
const tags = ["Everything"];
if (prettyCountry) {
  // Formats "United Kingdom" to "united-kingdom"
  const cleanTag = prettyCountry.toLowerCase().replace(/\s+/g, '-');
  tags.push(cleanTag);
}

const friendlyDate = now.toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});

// 4. Match the description and file logic from watch-photos.mjs
const description = `${friendlyDate} ${title}${prettyCountry ? ` in ${prettyCountry}` : ''}`;
const blogDir = `./src/content/log/${year}/${month}`;
const blogFile = `${blogDir}/${name}.md`;

if (!fs.existsSync(blogDir)) fs.mkdirSync(blogDir, { recursive: true });

// 5. Generate the final Markdown content
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

console.log(`✓ Created blog post: ${blogFile}`);
console.log(`✓ URL will be: /log/${year}/${month}/${name}`);