package main

import (
	"fmt"
	"strings"
)

type Animal struct {
	Name string
}

type Dog struct {
	Animal
	Breed string
}

func (a *Animal) Speak() string {
	return fmt.Sprintf("%s makes a sound.", a.Name)
}

func (d *Dog) Speak() string {
	return fmt.Sprintf("%s barks.", d.Name)
}

func (d *Dog) FetchBreed() string {
	return strings.ToUpper(d.Breed)
}

func FormatAnimal(name string) string {
	return fmt.Sprintf("[%s]", name)
}

func main() {
	dog := &Dog{Animal: Animal{Name: "Rex"}, Breed: "Labrador"}
	fmt.Println(dog.Speak())
}
