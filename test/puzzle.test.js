const assert = require("node:assert/strict");
const test = require("node:test");
const puzzle = require("../src/puzzle.js");

function masksOf(clues, length) {
  return puzzle
    .allPlacements(clues, length)
    .slice()
    .sort((a, b) => a - b);
}

function hasExtremeLine(solution, rows, cols) {
  for (let r = 0; r < rows; r++) {
    let count = 0;
    for (let c = 0; c < cols; c++) count += solution[r * cols + c];
    if (count === 0 || count === cols) return true;
  }
  for (let c = 0; c < cols; c++) {
    let count = 0;
    for (let r = 0; r < rows; r++) count += solution[r * cols + c];
    if (count === 0 || count === rows) return true;
  }
  return false;
}

function isRectangle(solution, rows, cols) {
  let minR = rows;
  let maxR = -1;
  let minC = cols;
  let maxC = -1;
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solution[r * cols + c]) continue;
      filled++;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  return filled === (maxR - minR + 1) * (maxC - minC + 1);
}

function countSolutions(rowClues, colClues, limit) {
  const rowCount = rowClues.length;
  const colCount = colClues.length;
  const rowPlacements = rowClues.map((clue) =>
    puzzle.allPlacements(clue, colCount),
  );
  const colPlacements = colClues.map((clue) =>
    puzzle.allPlacements(clue, rowCount),
  );
  const chosen = [];
  let count = 0;

  function columnPrefixOk() {
    const rowsAssigned = chosen.length;
    for (let c = 0; c < colCount; c++) {
      let prefix = 0;
      for (let r = 0; r < rowsAssigned; r++) {
        if ((chosen[r] >> c) & 1) prefix |= 1 << r;
      }
      const options = colPlacements[c];
      let ok = false;
      for (let i = 0; i < options.length; i++) {
        const bits = options[i];
        let match = true;
        for (let r = 0; r < rowsAssigned; r++) {
          if (((bits >> r) & 1) !== ((prefix >> r) & 1)) {
            match = false;
            break;
          }
        }
        if (match) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
    return true;
  }

  function walk(row) {
    if (count >= limit) return;
    if (row === rowCount) {
      count++;
      return;
    }
    const options = rowPlacements[row];
    for (let i = 0; i < options.length; i++) {
      chosen.push(options[i]);
      if (columnPrefixOk()) walk(row + 1);
      chosen.pop();
      if (count >= limit) return;
    }
  }

  walk(0);
  return count;
}

test("placements for [2,1] in 5", () => {
  const got = masksOf([2, 1], 5);
  assert.deepEqual(
    got,
    [0b01011, 0b10011, 0b10110].sort((a, b) => a - b),
  );
});

test("empty and full lines", () => {
  assert.deepEqual(masksOf([], 4), [0]);
  assert.deepEqual(masksOf([4], 4), [0b1111]);
  assert.deepEqual(masksOf([3, 3], 5), []);
});

test("overlap solve of a unique 2x2", () => {
  const solution = Uint8Array.from([1, 1, 1, 0]);
  const { rows, cols } = puzzle.buildClues(solution, 2, 2);
  const result = puzzle.solve(rows, cols, 0);
  assert.equal(result.solved, true);
  assert.equal(result.depthUsed, 0);
  assert.equal(countSolutions(rows, cols, 2), 1);
});

test("ambiguous 2x2 is not called solved", () => {
  const rows = [[1], [1]];
  const cols = [[1], [1]];
  const result = puzzle.solve(rows, cols, 1);
  assert.equal(result.solved, false);
  assert.equal(countSolutions(rows, cols, 2), 2);
});

test("generated puzzles are unique, solvable, and stable", () => {
  const cases = [
    [5, 5, "easy"],
    [5, 5, "medium"],
    [7, 10, "easy"],
    [7, 10, "medium"],
    [10, 10, "easy"],
    [10, 10, "medium"],
    [20, 20, "easy"],
    [20, 20, "medium"],
  ];
  for (const [rows, cols, difficulty] of cases) {
    const label = rows + "x" + cols + " " + difficulty;
    const started = Date.now();
    const seedCount = rows === 20 && cols === 20 ? 2 : 12;
    for (let seed = 1; seed <= seedCount; seed++) {
      const a = puzzle.generatePuzzle(rows, cols, difficulty, seed);
      assert.equal(a.solution.length, a.rows * a.cols);
      assert.equal(a.rows, rows);
      assert.equal(a.cols, cols);
      assert.equal(a.rowClues.length, a.rows);
      assert.equal(a.colClues.length, a.cols);
      assert.equal(a.depthUsed, difficulty === "easy" ? 0 : 1);
      assert.deepEqual(
        puzzle.generatePuzzle(rows, cols, difficulty, seed).rowClues,
        a.rowClues,
      );
      const count = countSolutions(a.rowClues, a.colClues, 2);
      assert.equal(count, 1, label + " seed " + seed);
      assert.equal(isRectangle(a.solution, a.rows, a.cols), false);
      assert.equal(
        hasExtremeLine(a.solution, a.rows, a.cols),
        false,
        label + " seed " + seed,
      );
    }
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed < (rows === 20 && cols === 20 ? 20000 : 8000),
      label + " took " + elapsed + "ms",
    );
  }
});
