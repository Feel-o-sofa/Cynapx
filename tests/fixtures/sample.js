const path = require('path');

class Animal {
    constructor(name) {
        this.name = name;
    }

    speak() {
        return `${this.name} makes a sound.`;
    }
}

class Dog extends Animal {
    constructor(name, breed) {
        super(name);
        this.breed = breed;
    }

    speak() {
        return `${this.name} barks.`;
    }

    fetchBreed() {
        return this.breed;
    }
}

function formatAnimal(animal) {
    return `[${animal.name}]`;
}

module.exports = { Animal, Dog, formatAnimal };
