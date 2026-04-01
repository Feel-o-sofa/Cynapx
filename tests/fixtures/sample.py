import os
from pathlib import Path

class Animal:
    def __init__(self, name: str):
        self.name = name

    def speak(self) -> str:
        return f"{self.name} makes a sound."

class Dog(Animal):
    def __init__(self, name: str, breed: str):
        super().__init__(name)
        self.breed = breed

    def speak(self) -> str:
        return f"{self.name} barks."

    def fetch_breed(self) -> str:
        return self.breed

def format_animal(animal: Animal) -> str:
    return f"[{animal.name}]"
