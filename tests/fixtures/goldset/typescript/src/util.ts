export function format(n: number): string {
    return `#${n}`;
}

export function log(msg: string): void {
    void msg;
}

export function factorial(n: number): number {
    return n <= 1 ? 1 : n * factorial(n - 1);
}
