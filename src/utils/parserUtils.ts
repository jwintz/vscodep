import matter from 'gray-matter';
import { ConfigMetadata } from '../types/config';

/**
 * Parse front-matter from markdown files
 */
export function parseFrontMatter(content: string): {
    content: string;
    metadata: ConfigMetadata;
} {
    try {
        const parsed = matter(content);

        const metadata: ConfigMetadata = {
            frontMatter: parsed.data,
            inclusion: parsed.data.inclusion || 'always',
            fileMatchPatterns: parsed.data.fileMatchPattern
                ? (Array.isArray(parsed.data.fileMatchPattern)
                    ? parsed.data.fileMatchPattern
                    : [parsed.data.fileMatchPattern])
                : undefined,
            description: parsed.data.description,
        };

        return {
            content: parsed.content,
            metadata,
        };
    } catch (error) {
        // If parsing fails, return content as-is with default metadata
        return {
            content,
            metadata: {
                inclusion: 'always',
            },
        };
    }
}

/**
 * Extract file references from content (e.g., #[[file:path/to/file]])
 */
export function extractFileReferences(content: string): string[] {
    const fileRefPattern = /#\[\[file:([^\]]+)\]\]/g;
    const references: string[] = [];
    let match;

    while ((match = fileRefPattern.exec(content)) !== null) {
        references.push(match[1]);
    }

    return references;
}

/**
 * Clean and normalize content for AI consumption
 */
export function normalizeContentForAI(content: string): string {
    return content
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/\n{3,}/g, '\n\n') // Collapse excessive newlines
        .trim();
}

/**
 * Truncate content to specified length with smart word boundaries
 */
export function truncateContent(
    content: string,
    maxLength: number,
    suffix = '...[truncated]'
): string {
    if (content.length <= maxLength) {
        return content;
    }

    // Find last space before maxLength to avoid cutting words
    const truncateAt = content.lastIndexOf(' ', maxLength - suffix.length);
    const cutPoint = truncateAt > maxLength * 0.8 ? truncateAt : maxLength - suffix.length;

    return content.substring(0, cutPoint) + suffix;
}
