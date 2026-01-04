class Library {
  constructor(name) {
    this.name = name;
    this.shelves = [];
  }

  addShelf(label) {
    const shelf = new Library.Shelf(label);
    this.shelves.push(shelf);
    return shelf; // so we can chain things
  }

  listEverything() {
    console.log(`Library: ${this.name}`);
    this.shelves.forEach((shelf) => {
      console.log(`  Shelf: ${shelf.label}`);
      shelf.books.forEach((book) => {
        console.log(`    - ${book.title} by ${book.author}`);
      });
    });
  }

  // Nested Shelf class
  static Shelf = class {
    constructor(label) {
      this.label = label;
      this.books = [];
    }

    addBook(title, author) {
      const book = new Library.Shelf.Book(title, author);
      this.books.push(book);
    }

    // Nested Book class inside Shelf
    static Book = class {
      constructor(title, author) {
        this.title = title;
        this.author = author;
      }
    };
  };
}

// Usage
const lib = new Library("Master’s Private Archive");

const refShelf = lib.addShelf("Reference");
refShelf.addBook("The Pragmatic Programmer", "Hunt & Thomas");
refShelf.addBook("Clean Code", "Robert C. Martin");

const fictionShelf = lib.addShelf("Fiction");
fictionShelf.addBook("Dune", "Frank Herbert");
fictionShelf.addBook("Neuromancer", "William Gibson");

lib.listEverything();
