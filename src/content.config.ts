import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

const log = defineCollection({
	// Load Markdown and MDX files in the `src/content/log/` directory.
	loader: glob({ base: "./src/content/log", pattern: "**/*.{md,mdx}" }),
	// Type-check frontmatter using a schema
	schema: z.object({
		title: z.string(),
		description: z.string(),
		// Transform string to Date object
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
		thumbImage: z.string().optional(),
		latitude: z.number().nullable().optional(),
		longitude: z.number().nullable().optional(),
		tags: z.array(z.string())
			.default([])
			.transform(tags => [...new Set(tags.map(tag => tag.toLowerCase()))]),
	}),
});

export const collections = { log };
