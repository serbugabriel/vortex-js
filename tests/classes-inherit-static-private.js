// Base class
class Animal {
  static kingdom = "Animalia"; // Static property
  #age; // Private field

  constructor(name, age) {
    this.name = name;
    this.#age = age;
  }

  speak() {
    console.log(`${this.name} makes a sound.`);
  }

  getAge() {
    return this.#age;
  }

  setAge(newAge) {
    if (newAge > 0) {
      this.#age = newAge;
    } else {
      console.log("Age must be positive");
    }
  }

  static info() {
    console.log(`All animals belong to the kingdom ${this.kingdom}.`);
  }
}

// Derived class
class Dog extends Animal {
  static species = "Canis lupus familiaris";

  #breed; // Private field

  constructor(name, age, breed) {
    super(name, age);
    this.#breed = breed;
  }

  speak() {
    console.log(`${this.name} barks.`);
  }

  getBreed() {
    return this.#breed;
  }

  setBreed(newBreed) {
    this.#breed = newBreed;
  }

  static speciesInfo() {
    console.log(`Dogs are of species: ${this.species}`);
  }
}

// Usage
const dog = new Dog("Buddy", 3, "Golden Retriever");

dog.speak(); // Buddy barks.
console.log(dog.getAge()); // 3
dog.setAge(4);
console.log(dog.getAge()); // 4

console.log(dog.getBreed()); // Golden Retriever
dog.setBreed("Labrador");
console.log(dog.getBreed()); // Labrador

// Static methods
Animal.info(); // All animals belong to the kingdom Animalia.
Dog.speciesInfo(); // Dogs are of species: Canis lupus familiaris
