// Base class (Parent)
class Animal {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }

  // Method in the parent class
  speak() {
    console.log(`${this.name} makes a sound.`);
  }

  // Another method
  introduce() {
    console.log(`Hi, I'm ${this.name} and I'm ${this.age} years old.`);
  }
}

// Derived class (Child) - inherits from Animal
class Dog extends Animal {
  constructor(name, age, breed) {
    super(name, age); // Call the parent constructor
    this.breed = breed;
  }

  // Override the speak method
  speak() {
    console.log(`${this.name} barks loudly! Woof woof!`);
  }

  // New method specific to Dog
  fetch() {
    console.log(`${this.name} is fetching the ball!`);
  }
}

// Another derived class
class Cat extends Animal {
  constructor(name, age, color) {
    super(name, age);
    this.color = color;
  }

  // Override speak
  speak() {
    console.log(`${this.name} meows softly. Meow~`);
  }

  // Cat-specific method
  purr() {
    console.log(`${this.name} is purring happily.`);
  }
}

// Usage example
const animal = new Animal("Generic Animal", 5);
const dog = new Dog("Buddy", 3, "Golden Retriever");
const cat = new Cat("Whiskers", 2, "Gray");

animal.introduce(); // Hi, I'm Generic Animal and I'm 5 years old.
animal.speak(); // Generic Animal makes a sound.

dog.introduce(); // Hi, I'm Buddy and I'm 3 years old.
dog.speak(); // Buddy barks loudly! Woof woof!
dog.fetch(); // Buddy is fetching the ball!

cat.introduce(); // Hi, I'm Whiskers and I'm 2 years old.
cat.speak(); // Whiskers meows softly. Meow~
cat.purr(); // Whiskers is purring happily.
