/**
 * Tests complex expressions and operator precedence.
 */
function calculate(a, b, c) {
  // Should evaluate as 5 + (10 * 4) / 2 = 5 + 20 = 25
  return a + (b * c) / 2;
}

let result = calculate(5, 10, 4);
