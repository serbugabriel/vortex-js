// Base class
class Animal {
  constructor(name) {
    this.name = name;
  }

  speak() {
    return `${this.name} makes a sound.`;
  }

  describe(prefix) {
    return `${prefix}: ${this.name}`;
  }
}

// Derived class
class Dog extends Animal {
  constructor(name) {
    super(name);
  }

  // Override + super.method()
  speak() {
    const base = super.speak();
    return base + " Woof!";
  }

  // super.method() with arguments
  describe(prefix) {
    return super.describe(prefix.toUpperCase());
  }
}

// ---- Tests ----
const dog = new Dog("Buddy");

// Test 1: overridden method calling super.method()
console.log(dog.speak());
// Expected:
// Buddy makes a sound. Woof!

// Test 2: super.method() with arguments
console.log(dog.describe("dog"));
// Expected:
// DOG: Buddy

// Test 3: prototype integrity
console.log(dog instanceof Dog); // true
console.log(dog instanceof Animal); // true

// Test 4: base method still callable directly
console.log(Animal.prototype.speak.call(dog));
// Expected:
// Buddy makes a sound.
