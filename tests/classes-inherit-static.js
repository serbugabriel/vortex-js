// Base class
class Animal {
  static kingdom = "Animalia"; // Static property

  constructor(name) {
    this.name = name;
  }

  speak() {
    console.log(`${this.name} makes a sound.`);
  }

  // Static method
  static info() {
    console.log(`All animals belong to the kingdom ${this.kingdom}.`);
  }
}

// Derived class
class Dog extends Animal {
  static species = "Canis lupus familiaris"; // Static property

  constructor(name, breed) {
    super(name);
    this.breed = breed;
  }

  speak() {
    console.log(`${this.name} barks.`);
  }

  static speciesInfo() {
    console.log(`Dogs are of species: ${this.species}`);
  }
}

// Using instance methods
const dog = new Dog("Buddy", "Golden Retriever");
dog.speak(); // Buddy barks.
console.log(dog.breed); // Golden Retriever

// Using static methods and properties
Animal.info(); // All animals belong to the kingdom Animalia.
console.log(Animal.kingdom); // Animalia

Dog.info(); // All animals belong to the kingdom Animalia. (inherits static method)
Dog.speciesInfo(); // Dogs are of species: Canis lupus familiaris
console.log(Dog.species); // Canis lupus familiaris
