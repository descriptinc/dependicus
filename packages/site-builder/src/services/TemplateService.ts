import Handlebars from 'handlebars';
import { helpers } from '../templates/helpers';

// Partials
import navPartial from '../templates/partials/nav.hbs';
import upgradePathPartial from '../templates/partials/upgrade-path.hbs';

// Layouts
import baseLayout from '../templates/layouts/base.hbs';
import indexLayout from '../templates/layouts/index.hbs';

// Pages
import dependencyDetailPage from '../templates/pages/dependency-detail.hbs';
import groupingDetailPage from '../templates/pages/grouping-detail.hbs';
import groupingIndexPage from '../templates/pages/grouping-index.hbs';
import indexPage from '../templates/pages/index.hbs';

const templateMap: Record<string, string> = {
    'layouts/base': baseLayout,
    'layouts/index': indexLayout,
    'pages/dependency-detail': dependencyDetailPage,
    'pages/grouping-detail': groupingDetailPage,
    'pages/grouping-index': groupingIndexPage,
    'pages/index': indexPage,
};

export class TemplateService {
    private handlebars: typeof Handlebars;
    private templateCache: Map<string, HandlebarsTemplateDelegate> = new Map();

    constructor() {
        this.handlebars = Handlebars.create();
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
     * Register all partials
     */
    private registerPartials(): void {
        this.handlebars.registerPartial('nav', navPartial);
        this.handlebars.registerPartial('upgrade-path', upgradePathPartial);
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

        const content = templateMap[templatePath];
        if (!content) {
            throw new Error(`Unknown template: "${templatePath}"`);
        }

        const compiled = this.handlebars.compile(content);
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
