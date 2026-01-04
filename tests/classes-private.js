class Outer {
  // private field
  #secret = "outer-secret";

  // static field
  static version = "1.0";

  // static method
  static info() {
    return `Outer class v${Outer.version}`;
  }

  // public method that uses private field
  revealSecret() {
    return this.#secret;
  }

  // Nested class
  static Inner = class {
    // private field
    #innerSecret = "inner-secret";

    // static method
    static describe() {
      return "I am the nested Inner class.";
    }

    constructor(value) {
      this.value = value;
    }

    // private method
    #compute() {
      return this.value * 2;
    }

    getResult() {
      return this.#compute();
    }

    getInnerSecret() {
      return this.#innerSecret;
    }
  };
}

// ---- Usage ----

// Accessing static methods
console.log(Outer.info()); // Outer class v1.0
console.log(Outer.Inner.describe()); // I am the nested Inner class.

// Creating instances
const outer = new Outer();
const inner = new Outer.Inner(21);

// Using instance methods
console.log(outer.revealSecret()); // outer-secret
console.log(inner.getResult()); // 42
console.log(inner.getInnerSecret()); // inner-secret
