// Base class
class Animal {
  speak() {
    return "Animal";
  }
}

// Derived class
class Dog extends Animal {
  speak() {
    // Arrow captures both `this` and `super`
    const callSuper = () => super.speak();
    return callSuper() + " → Dog";
  }
}

// ---- Tests ----
const dog = new Dog();

// Test 1: arrow + super
console.log(dog.speak());
// Expected:
// Animal → Dog

// Test 2: ensure base method unchanged
console.log(Animal.prototype.speak.call(dog));
// Expected:
// Animal

// Test 3: prototype integrity
console.log(dog instanceof Dog); // true
console.log(dog instanceof Animal); // true
