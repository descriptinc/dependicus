import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import Handlebars from 'handlebars';
import { helpers } from '../templates/helpers';

export class TemplateService {
    private handlebars: typeof Handlebars;
    private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();
    private templatesDir: string;

    constructor(templatesDir?: string) {
        this.handlebars = Handlebars.create();
        // Default to templates directory relative to this file
        this.templatesDir = templatesDir || resolve(__dirname, '../templates');

        this.registerHelpers();
        this.registerPartials();
    }

    /**
     * Register custom Handlebars helpers
     */
    private registerHelpers(): void {
        for (const [name, helper] of Object.entries(helpers)) {
            this.handlebars.registerHelper(name, helper);
        }

        // Register built-in comparison helpers
        this.handlebars.registerHelper('gt', (a: number, b: number) => a > b);
        this.handlebars.registerHelper('lt', (a: number, b: number) => a < b);
        this.handlebars.registerHelper('gte', (a: number, b: number) => a >= b);
        this.handlebars.registerHelper('lte', (a: number, b: number) => a <= b);
    }

    /**
     * Register all partials from templates/partials directory
     */
    private registerPartials(): void {
        const partialsDir = join(this.templatesDir, 'partials');

        try {
            const files = readdirSync(partialsDir);

            for (const file of files) {
                if (!file.endsWith('.hbs')) continue;

                const partialPath = join(partialsDir, file);
                const partialName = basename(file, '.hbs');
                const partialContent = readFileSync(partialPath, 'utf-8');

                this.handlebars.registerPartial(partialName, partialContent);
            }
        } catch (error) {
            // Partials directory might not exist yet during initial setup
            process.stderr.write(
                `Warning: Could not load partials from ${partialsDir}: ${error}\n`,
            );
        }
    }

    /**
     * Compile and cache a template
     */
    private compileTemplate(templatePath: string): HandlebarsTemplateDelegate {
        // Check cache first
        const cached = this.templateCache.get(templatePath);
        if (cached) {
            return cached;
        }

        // Read and compile template
        const fullPath = join(this.templatesDir, `${templatePath}.hbs`);
        const templateContent = readFileSync(fullPath, 'utf-8');
        const compiled = this.handlebars.compile(templateContent);

        // Cache for future use
        this.templateCache.set(templatePath, compiled);

        return compiled;
    }

    /**
     * Render a template with data
     * @param templatePath Path relative to templates directory (e.g., 'pages/index')
     * @param data Data to pass to the template
     */
    render(templatePath: string, data: Record<string, unknown>): string {
        try {
            const template = this.compileTemplate(templatePath);
            return template(data);
        } catch (error) {
            throw new Error(`Failed to render template "${templatePath}": ${error}`);
        }
    }

    /**
     * Clear the template cache (useful for development/testing)
     */
    clearCache(): void {
        this.templateCache.clear();
    }
}
