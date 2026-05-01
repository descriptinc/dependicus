declare module 'tabulator-tables' {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export class TabulatorFull {
        constructor(element: string | HTMLElement, options: any);
        on(event: string, callback: (...args: any[]) => void): void;
        redraw(): void;
        destroy(): void;
        setHeaderFilterValue(field: string, value: string): void;
    }
}
