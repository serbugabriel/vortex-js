// Base class
class Animal {
  constructor(name) {
    this._name = name;
  }

  get info() {
    return `Animal: ${this._name}`;
  }

  set info(value) {
    this._name = value;
  }
}

// Derived class
class Dog extends Animal {
  constructor(name) {
    super(name);
  }

  // getter using super
  get info() {
    return super.info + " (Dog)";
  }

  // setter using super
  set info(value) {
    super.info = value.toUpperCase();
  }
}

// ---- Tests ----
const dog = new Dog("Buddy");

// Test 1: getter super
console.log(dog.info);
// Expected:
// Animal: Buddy (Dog)

// Test 2: setter super
dog.info = "max";
console.log(dog.info);
// Expected:
// Animal: MAX (Dog)

// Test 3: prototype integrity
console.log(dog instanceof Dog); // true
console.log(dog instanceof Animal); // true

// Test 4: base getter still works
console.log(
  Object.getOwnPropertyDescriptor(Animal.prototype, "info").get.call(dog),
);
// Expected:
// Animal: MAX
