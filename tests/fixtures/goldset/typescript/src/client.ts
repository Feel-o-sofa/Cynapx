import { format } from './util';

export function configure(): string {
    return 'free';
}

export class Client {
    configure(): string {
        return format(1);
    }

    run(): string {
        return this.configure();
    }
}
