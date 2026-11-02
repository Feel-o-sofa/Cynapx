import { Client, configure } from './client';
import { log, factorial } from './util';

export function useClient(c: Client): void {
    c.configure();
    configure();
    log(String(factorial(5)));
}

export function shutdown(): void {
    console.log('bye');
}
