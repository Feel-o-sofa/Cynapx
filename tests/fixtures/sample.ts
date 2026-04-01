import { EventEmitter } from 'events';

interface Greetable {
    greet(name: string): string;
}

class Animal {
    constructor(public name: string) {}

    public speak(): string {
        return `${this.name} makes a sound.`;
    }
}

class Dog extends Animal implements Greetable {
    private breed: string;

    constructor(name: string, breed: string) {
        super(name);
        this.breed = breed;
    }

    public speak(): string {
        return `${this.name} barks.`;
    }

    public greet(person: string): string {
        return `Woof! Hello, ${person}!`;
    }

    private fetchBreed(): string {
        return this.breed;
    }
}

function formatAnimal(animal: Animal): string {
    return `[${animal.name}]`;
}
