// Base class
class Animal {
  speak() {
    return "Animal";
  }
}

// Middle class
class Mammal extends Animal {
  speak() {
    return super.speak() + " → Mammal";
  }
}

// Derived class
class Dog extends Mammal {
  speak() {
    return super.speak() + " → Dog";
  }
}

// ---- Tests ----
const dog = new Dog();

// Test 1: deep super chain
console.log(dog.speak());
// Expected:
// Animal → Mammal → Dog

// Test 2: instanceof chain
console.log(dog instanceof Dog); // true
console.log(dog instanceof Mammal); // true
console.log(dog instanceof Animal); // true

// Test 3: direct base call still works
console.log(Animal.prototype.speak.call(dog));
// Expected:
// Animal
