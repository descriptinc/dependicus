import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateService } from './TemplateService';

describe('TemplateService', () => {
    let service: TemplateService;

    beforeEach(() => {
        service = new TemplateService();
    });

    describe('render', () => {
        it('renders base layout with content', () => {
            const html = service.render('layouts/base', {
                title: 'Test Page',
                siteName: 'Dependicus',
                content: '<p>Hello World</p>',
                baseHref: '',
                timestamp: '2025-01-01',
            });

            expect(html).toContain('Test Page - Dependicus');
            expect(html).toContain('<p>Hello World</p>');
            expect(html).toContain('2025-01-01');
        });

        it('renders index layout with CSS and JS', () => {
            const html = service.render('layouts/index', {
                title: 'Dep Report',
                cssContent: 'body { color: red; }',
                bundledJs: 'console.log("hello");',
                content: '<div>Tables here</div>',
                timestamp: '2025-01-01',
            });

            expect(html).toContain('body { color: red; }');
            expect(html).toContain('console.log("hello");');
            expect(html).toContain('<div>Tables here</div>');
        });

        it('renders partials (nav)', () => {
            const html = service.render('layouts/base', {
                title: 'Test',
                content: 'content',
                baseHref: '../',
                timestamp: 'now',
            });

            expect(html).toContain('Dependencies');
            expect(html).toContain('../index.html');
        });

        it('throws on missing template', () => {
            expect(() => service.render('pages/nonexistent', {})).toThrow(
                'Failed to render template',
            );
        });
    });

    describe('helpers', () => {
        it('uses eq helper in templates', () => {
            const html = service.render('pages/dependency-detail', {
                name: 'test-pkg',
                version: '1.0.0',
                latestVersion: '1.0.0',
                inCatalog: true,
                usedByCount: 0,
                // eslint-disable-next-line no-null/no-null
                usedByGrouped: null,
                usedByFlat: [],
                upgradePath: { hasVersionsBetween: false },
            });

            expect(html).toContain('test-pkg@1.0.0');
            expect(html).toContain('Yes');
        });
    });

    describe('clearCache', () => {
        it('clears the template cache', () => {
            // Render once to populate cache
            service.render('layouts/base', {
                title: 'Test',
                content: '',
                baseHref: '',
                timestamp: '',
            });

            // Should not throw
            service.clearCache();

            // Should still work after clearing
            const html = service.render('layouts/base', {
                title: 'Test2',
                content: '',
                baseHref: '',
                timestamp: '',
            });
            expect(html).toContain('Test2');
        });
    });

    describe('template caching', () => {
        it('returns same result on second render (uses cache)', () => {
            const data = {
                title: 'Cache Test',
                content: '<p>cached</p>',
                baseHref: '',
                timestamp: '2025-01-01',
            };

            const first = service.render('layouts/base', data);
            const second = service.render('layouts/base', data);
            expect(first).toBe(second);
        });
    });

    describe('comparison helpers', () => {
        it('gt helper works in templates', () => {
            const html = service.render('pages/grouping-index', {
                label: 'Test',
                items: [{ value: 'A', count: 5, slug: 'a.html', outdatedCount: 3 }],
            });
            // With outdatedCount > 0, it should show "outdated"
            expect(html).toContain('3 outdated');
        });

        it('gt helper hides when count is 0', () => {
            const html = service.render('pages/grouping-index', {
                label: 'Test',
                items: [{ value: 'A', count: 5, slug: 'a.html', outdatedCount: 0 }],
            });
            expect(html).not.toContain('outdated');
        });
    });

    describe('partials', () => {
        it('upgrade-path partial renders when hasVersionsBetween is true', () => {
            const html = service.render('pages/dependency-detail', {
                name: 'test',
                version: '1.0.0',
                latestVersion: '2.0.0',
                usedByCount: 0,
                // eslint-disable-next-line no-null/no-null
                usedByGrouped: null,
                usedByFlat: [],
                upgradePath: {
                    hasVersionsBetween: true,
                    currentVersion: '1.0.0',
                    latestVersion: '2.0.0',
                    versionCount: 1,
                    versions: [
                        {
                            version: '2.0.0',
                            formattedPublishDate: '2025-01-01',
                            registryUrl: 'https://npmjs.com/pkg',
                            isLatest: true,
                        },
                    ],
                },
            });
            expect(html).toContain('Upgrade Path');
            expect(html).toContain('Version History');
        });

        it('upgrade-path partial is hidden when hasVersionsBetween is false', () => {
            const html = service.render('pages/dependency-detail', {
                name: 'test',
                version: '1.0.0',
                latestVersion: '1.0.0',
                usedByCount: 0,
                // eslint-disable-next-line no-null/no-null
                usedByGrouped: null,
                usedByFlat: [],
                upgradePath: { hasVersionsBetween: false },
            });
            expect(html).not.toContain('Upgrade Path');
        });

        it('nav partial renders grouping links', () => {
            const html = service.render('layouts/base', {
                title: 'Test',
                content: '',
                baseHref: '',
                timestamp: '',
                groupings: [
                    { label: 'Surfaces', slug: 'surfaces' },
                    { label: 'Teams', slug: 'teams' },
                ],
            });
            expect(html).toContain('surfaces/index.html');
            expect(html).toContain('Surfaces');
            expect(html).toContain('teams/index.html');
            expect(html).toContain('Teams');
        });

        it('nav partial renders no grouping links when none configured', () => {
            const html = service.render('layouts/base', {
                title: 'Test',
                content: '',
                baseHref: '',
                timestamp: '',
            });
            // Should only have "Dependencies" link
            expect(html).toContain('Dependencies');
        });
    });

    describe('grouping templates', () => {
        it('renders grouping-detail with sections', () => {
            const html = service.render('pages/grouping-detail', {
                label: 'Teams',
                value: 'Infrastructure',
                count: 2,
                dependencies: [
                    {
                        name: 'pkg-a',
                        version: '1.0.0',
                        latestVersion: '2.0.0',
                        detailLink: '../details/pkg-a@1.0.0.html',
                    },
                ],
                stats: {
                    totalDependencies: 2,
                    outdatedCount: 1,
                    catalogCount: 0,
                },
                sections: [
                    {
                        title: 'Compliance',
                        stats: [{ label: 'Non-Compliant', value: 1 }],
                        flaggedDependencies: [
                            {
                                name: 'pkg-a',
                                version: '1.0.0',
                                detailLink: '../details/pkg-a@1.0.0.html',
                                label: '1 major behind',
                            },
                        ],
                    },
                ],
            });
            expect(html).toContain('Teams: Infrastructure');
            expect(html).toContain('<dt>Total Dependencies</dt><dd>2</dd>');
            expect(html).toContain('Compliance');
            expect(html).toContain('<dt>Non-Compliant</dt><dd>1</dd>');
            expect(html).toContain('1 major behind');
        });

        it('renders grouping-detail with up-to-date packages', () => {
            const html = service.render('pages/grouping-detail', {
                label: 'Teams',
                value: 'Core',
                count: 1,
                dependencies: [
                    {
                        name: 'pkg-a',
                        version: '1.0.0',
                        latestVersion: '1.0.0',
                        detailLink: '../details/pkg-a@1.0.0.html',
                    },
                ],
                stats: {
                    totalDependencies: 1,
                    outdatedCount: 0,
                    catalogCount: 1,
                },
            });
            expect(html).toContain('Teams: Core');
        });
    });
});
