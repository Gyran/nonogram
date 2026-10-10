(() => {
  const board = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const seedInput = document.getElementById("seed");
  const seedForm = document.getElementById("seed-form");

  const state = {
    rows: 5,
    cols: 5,
    difficulty: "easy",
    seed: 1,
    puzzle: null,
    marks: new Uint8Array(0),
    stroke: null,
    tap: null,
    checked: false,
    note: "",
  };

  let noteTimer = 0;

  function randomSeed() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] || 1;
  }

  function parseDim(raw) {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 2 ? n : null;
  }

  function dimsFromLegacySize(raw) {
    if (raw === "5" || raw === "10" || raw === "20") {
      const n = Number(raw);
      return { rows: n, cols: n };
    }
    if (raw === "7x10") return { rows: 7, cols: 10 };
    return null;
  }

  function readParams() {
    const params = new URLSearchParams(location.search);
    let rows = parseDim(params.get("rows"));
    let cols = parseDim(params.get("cols"));
    if (rows === null || cols === null) {
      const legacy = dimsFromLegacySize(params.get("size"));
      if (legacy) {
        rows = legacy.rows;
        cols = legacy.cols;
      } else {
        rows = 5;
        cols = 5;
      }
    }
    const difficulty =
      params.get("difficulty") === "medium" ? "medium" : "easy";
    const raw = params.get("seed");
    const seed = Number(raw);
    const valid =
      !!raw && /^[0-9]+$/.test(raw) && seed >= 1 && seed <= 0xffffffff;
    return { rows, cols, difficulty, seed: valid ? seed : null };
  }

  function writeParams(mode) {
    const url = new URL(location.href);
    url.searchParams.delete("size");
    url.searchParams.set("rows", String(state.rows));
    url.searchParams.set("cols", String(state.cols));
    url.searchParams.set("difficulty", state.difficulty);
    url.searchParams.set("seed", String(state.seed));
    history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
    seedInput.value = String(state.seed);
  }

  function storageKey() {
    return `nonogram:v3:${state.rows}x${state.cols}:${state.difficulty}:${state.seed}`;
  }

  function loadMarks(length) {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw || raw.length !== length) return new Uint8Array(length);
      const marks = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        const value = raw.charCodeAt(i) - 48;
        marks[i] = value === 1 || value === 2 ? value : 0;
      }
      return marks;
    } catch {
      return new Uint8Array(length);
    }
  }

  function saveMarks() {
    let empty = true;
    let raw = "";
    for (let i = 0; i < state.marks.length; i++) {
      raw += state.marks[i];
      if (state.marks[i]) empty = false;
    }
    try {
      if (empty) localStorage.removeItem(storageKey());
      else localStorage.setItem(storageKey(), raw);
    } catch {
      /* private mode can reject storage; the grid still works */
    }
  }

  function makePuzzle(rows, cols, difficulty, seed) {
    let next = seed >>> 0 || 1;
    let lastError = null;
    for (let hop = 0; hop < 8; hop++) {
      try {
        return Nonogram.generatePuzzle(rows, cols, difficulty, next);
      } catch (err) {
        lastError = err;
        next = (next + 1) >>> 0 || 1;
      }
    }
    throw lastError;
  }

  function openPuzzle(rows, cols, difficulty, seed, mode) {
    let puzzle;
    try {
      puzzle = makePuzzle(rows, cols, difficulty, seed);
    } catch (err) {
      seedInput.value = String(state.seed);
      statusEl.textContent = "Could not build that puzzle. Try another seed.";
      return;
    }
    state.rows = puzzle.rows;
    state.cols = puzzle.cols;
    state.difficulty = puzzle.difficulty;
    state.seed = puzzle.seed;
    state.puzzle = puzzle;
    state.marks = loadMarks(puzzle.solution.length);
    state.checked = false;
    state.stroke = null;
    state.note = "";
    clearTimeout(noteTimer);
    writeParams(mode);
    renderBoard();
    syncControls();
    updateStatus();
  }

  function syncControls() {
    document.querySelectorAll("[data-rows][data-cols]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(
          Number(button.dataset.rows) === state.rows &&
            Number(button.dataset.cols) === state.cols,
        ),
      );
    });
    document.querySelectorAll("[data-difficulty]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.difficulty === state.difficulty),
      );
    });
  }

  function nextMark(value) {
    if (value === 0) return 1;
    if (value === 1) return 2;
    return 0;
  }

  function cellLabel(index, value) {
    const cols = state.puzzle.cols;
    const row = ((index / cols) | 0) + 1;
    const col = (index % cols) + 1;
    const word =
      value === 1 ? "filled" : value === 2 ? "marked empty" : "empty";
    return "Row " + row + ", column " + col + ", " + word;
  }

  function renderBoard() {
    const puzzle = state.puzzle;
    const rows = puzzle.rows;
    const cols = puzzle.cols;
    board.style.setProperty("--cols", String(cols));
    board.dataset.rows = String(rows);
    board.dataset.cols = String(cols);
    board.replaceChildren();

    const corner = document.createElement("div");
    corner.className = "corner";
    board.appendChild(corner);

    for (let c = 0; c < cols; c++) {
      const clue = document.createElement("div");
      clue.className = "clue clue-col";
      clue.dataset.col = String(c);
      if ((c + 1) % 5 === 0 && c !== cols - 1) clue.classList.add("major-r");
      if (c === cols - 1) clue.classList.add("edge-r");
      appendNumbers(clue, puzzle.colClues[c]);
      board.appendChild(clue);
    }

    for (let r = 0; r < rows; r++) {
      const clue = document.createElement("div");
      clue.className = "clue clue-row";
      clue.dataset.row = String(r);
      if ((r + 1) % 5 === 0 && r !== rows - 1) clue.classList.add("major-b");
      if (r === rows - 1) clue.classList.add("edge-b");
      appendNumbers(clue, puzzle.rowClues[r]);
      board.appendChild(clue);

      for (let c = 0; c < cols; c++) {
        const index = r * cols + c;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.dataset.i = String(index);
        if ((c + 1) % 5 === 0 && c !== cols - 1) cell.classList.add("major-r");
        if (c === cols - 1) cell.classList.add("edge-r");
        if ((r + 1) % 5 === 0 && r !== rows - 1) cell.classList.add("major-b");
        if (r === rows - 1) cell.classList.add("edge-b");
        applyCell(cell, index);
        board.appendChild(cell);
      }
    }
    refreshClues();
  }

  function appendNumbers(el, clues) {
    const numbers = clues.length ? clues : [0];
    const row = el.classList.contains("clue-row");
    for (let i = 0; i < numbers.length; i++) {
      if (row && i > 0) {
        const sep = document.createElement("span");
        sep.className = "clue-sep";
        sep.textContent = ",\u00a0";
        sep.setAttribute("aria-hidden", "true");
        el.appendChild(sep);
      }
      const span = document.createElement("span");
      span.className = "clue-num";
      span.textContent = String(numbers[i]);
      el.appendChild(span);
    }
  }

  function applyCell(cell, index) {
    const value = state.marks[index];
    cell.dataset.v = String(value);
    cell.setAttribute("aria-label", cellLabel(index, value));
    const solution = state.puzzle.solution[index];
    const wrong =
      state.checked &&
      ((value === 1 && !solution) || (value === 2 && solution));
    cell.classList.toggle("bad", wrong);
  }

  function lineMet(values, clues) {
    let filled = 0;
    const runs = [];
    let run = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] === 1) {
        filled++;
        run++;
      } else if (run) {
        runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
    let sum = 0;
    for (let i = 0; i < clues.length; i++) sum += clues[i];
    if (filled !== sum || runs.length !== clues.length) return false;
    for (let i = 0; i < runs.length; i++)
      if (runs[i] !== clues[i]) return false;
    return true;
  }

  function refreshClues() {
    const marks = state.marks;
    const puzzle = state.puzzle;
    const rows = puzzle.rows;
    const cols = puzzle.cols;
    board.querySelectorAll(".clue-row").forEach((el) => {
      const r = Number(el.dataset.row);
      const values = [];
      for (let c = 0; c < cols; c++) values.push(marks[r * cols + c]);
      el.classList.toggle("is-met", lineMet(values, puzzle.rowClues[r]));
    });
    board.querySelectorAll(".clue-col").forEach((el) => {
      const c = Number(el.dataset.col);
      const values = [];
      for (let r = 0; r < rows; r++) values.push(marks[r * cols + c]);
      el.classList.toggle("is-met", lineMet(values, puzzle.colClues[c]));
    });
    board.classList.toggle("is-solved", isSolved());
  }

  function isSolved() {
    const solution = state.puzzle.solution;
    for (let i = 0; i < solution.length; i++) {
      if ((state.marks[i] === 1) !== !!solution[i]) return false;
    }
    return true;
  }

  function filledGoal() {
    let goal = 0;
    let have = 0;
    const solution = state.puzzle.solution;
    for (let i = 0; i < solution.length; i++) {
      if (solution[i]) goal++;
      if (state.marks[i] === 1) have++;
    }
    return have + " / " + goal + " filled";
  }

  function updateStatus() {
    statusEl.classList.toggle("solved", isSolved());
    if (state.note) {
      statusEl.textContent = state.note;
      return;
    }
    statusEl.textContent = isSolved()
      ? "Solved. " + filledGoal()
      : filledGoal();
  }

  function flash(message) {
    state.note = message;
    updateStatus();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      state.note = "";
      updateStatus();
    }, 1800);
  }

  function clearMistakes() {
    if (!state.checked) return;
    state.checked = false;
    board
      .querySelectorAll(".cell.bad")
      .forEach((cell) => cell.classList.remove("bad"));
  }

  function paintIndex(index, value) {
    if (state.marks[index] === value) return;
    state.note = "";
    clearTimeout(noteTimer);
    clearMistakes();
    state.marks[index] = value;
    const cell = board.querySelector('.cell[data-i="' + index + '"]');
    applyCell(cell, index);
    refreshClues();
    saveMarks();
    updateStatus();
  }

  function check() {
    state.checked = true;
    let mistakes = 0;
    board.querySelectorAll(".cell").forEach((cell) => {
      const index = Number(cell.dataset.i);
      applyCell(cell, index);
      if (cell.classList.contains("bad")) mistakes++;
    });
    if (isSolved()) flash("Solved.");
    else if (mistakes)
      flash(
        mistakes === 1
          ? "1 mark contradicts the clues."
          : mistakes + " marks contradict the clues.",
      );
    else flash("No wrong marks. Grid still open.");
  }

  function resetPuzzle() {
    state.marks = new Uint8Array(state.puzzle.solution.length);
    state.checked = false;
    state.note = "";
    clearTimeout(noteTimer);
    try {
      localStorage.removeItem(storageKey());
    } catch (err) {}
    board
      .querySelectorAll(".cell")
      .forEach((cell) => applyCell(cell, Number(cell.dataset.i)));
    refreshClues();
    updateStatus();
  }

  function solvePuzzle() {
    const solution = state.puzzle.solution;
    state.marks = new Uint8Array(solution.length);
    for (let i = 0; i < solution.length; i++) {
      state.marks[i] = solution[i] ? 1 : 2;
    }
    state.checked = false;
    state.note = "";
    clearTimeout(noteTimer);
    saveMarks();
    board
      .querySelectorAll(".cell")
      .forEach((cell) => applyCell(cell, Number(cell.dataset.i)));
    refreshClues();
    updateStatus();
  }

  board.addEventListener("pointerdown", function (event) {
    const cell = event.target.closest(".cell");
    if (!cell || event.button !== 0) return;
    const index = Number(cell.dataset.i);
    const touchScroll =
      document.body.classList.contains("is-fullscreen") &&
      event.pointerType === "touch";
    if (touchScroll) {
      state.tap = {
        pointerId: event.pointerId,
        index: index,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      return;
    }
    try {
      board.setPointerCapture(event.pointerId);
    } catch (err) {
      /* capture needs a live pointer; the first cell still paints */
    }
    event.preventDefault();
    state.stroke = nextMark(state.marks[index]);
    paintIndex(index, state.stroke);
  });

  board.addEventListener("pointermove", function (event) {
    if (state.tap && event.pointerId === state.tap.pointerId) {
      const dx = event.clientX - state.tap.x;
      const dy = event.clientY - state.tap.y;
      if (dx * dx + dy * dy > 64) state.tap.moved = true;
      return;
    }
    if (state.stroke === null || !board.hasPointerCapture(event.pointerId))
      return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const cell = hit && hit.closest ? hit.closest(".cell") : null;
    if (!cell || !board.contains(cell)) return;
    paintIndex(Number(cell.dataset.i), state.stroke);
  });

  function endStroke(event) {
    if (state.tap && event.pointerId === state.tap.pointerId) {
      const tap = state.tap;
      state.tap = null;
      if (!tap.moved) paintIndex(tap.index, nextMark(state.marks[tap.index]));
      return;
    }
    if (board.hasPointerCapture(event.pointerId))
      board.releasePointerCapture(event.pointerId);
    state.stroke = null;
  }

  board.addEventListener("pointerup", endStroke);
  board.addEventListener("pointercancel", endStroke);
  board.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  board.addEventListener("keydown", function (event) {
    const cell = event.target.closest(".cell");
    if (!cell) return;
    const cols = state.puzzle.cols;
    const rows = state.puzzle.rows;
    const index = Number(cell.dataset.i);
    let next = null;
    if (event.key === "ArrowLeft" && index % cols !== 0) next = index - 1;
    else if (event.key === "ArrowRight" && index % cols !== cols - 1)
      next = index + 1;
    else if (event.key === "ArrowUp" && index >= cols) next = index - cols;
    else if (event.key === "ArrowDown" && index < cols * (rows - 1))
      next = index + cols;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      paintIndex(index, nextMark(state.marks[index]));
      return;
    }
    if (next === null) return;
    event.preventDefault();
    board.querySelector('.cell[data-i="' + next + '"]').focus();
  });

  document.querySelectorAll("[data-rows][data-cols]").forEach((button) => {
    button.addEventListener("click", function () {
      const rows = Number(button.dataset.rows);
      const cols = Number(button.dataset.cols);
      if (rows === state.rows && cols === state.cols) return;
      openPuzzle(rows, cols, state.difficulty, state.seed, "push");
    });
  });

  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", function () {
      const difficulty = button.dataset.difficulty;
      if (difficulty === state.difficulty) return;
      openPuzzle(state.rows, state.cols, difficulty, state.seed, "push");
    });
  });

  document.getElementById("new-puzzle").addEventListener("click", function () {
    openPuzzle(state.rows, state.cols, state.difficulty, randomSeed(), "push");
  });

  document.getElementById("reset").addEventListener("click", resetPuzzle);
  document.getElementById("check").addEventListener("click", check);
  document.getElementById("solve").addEventListener("click", solvePuzzle);

  const fullscreenButton = document.getElementById("fullscreen");
  const exitFullscreenButton = document.getElementById("exit-fullscreen");

  function setFullscreen(on) {
    document.body.classList.toggle("is-fullscreen", on);
    fullscreenButton.setAttribute("aria-pressed", String(on));
    if (!on) {
      state.tap = null;
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (
        (document.fullscreenElement || document.webkitFullscreenElement) &&
        exit
      ) {
        exit.call(document).catch(function () {});
      }
      return;
    }
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) request.call(root).catch(function () {});
  }

  fullscreenButton.addEventListener("click", function () {
    setFullscreen(!document.body.classList.contains("is-fullscreen"));
  });
  exitFullscreenButton.addEventListener("click", function () {
    setFullscreen(false);
  });
  document.addEventListener("fullscreenchange", function () {
    if (
      !document.fullscreenElement &&
      document.body.classList.contains("is-fullscreen")
    ) {
      document.body.classList.remove("is-fullscreen");
      fullscreenButton.setAttribute("aria-pressed", "false");
      state.tap = null;
    }
  });
  document.addEventListener("keydown", function (event) {
    if (
      event.key === "Escape" &&
      document.body.classList.contains("is-fullscreen")
    ) {
      setFullscreen(false);
    }
  });

  seedForm.addEventListener("submit", function (event) {
    event.preventDefault();
    commitSeed();
  });

  seedInput.addEventListener("change", commitSeed);
  document.getElementById("copy-link").addEventListener("click", copyLink);

  function commitSeed() {
    const raw = seedInput.value.trim();
    const seed = Number(raw);
    if (!/^[0-9]+$/.test(raw) || seed < 1 || seed > 0xffffffff) {
      seedInput.value = String(state.seed);
      flash("Seed must be a number from 1 to 4294967295.");
      return;
    }
    if (seed === state.seed) return;
    openPuzzle(state.rows, state.cols, state.difficulty, seed, "push");
  }

  function copyLink() {
    const link = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(
        function () {
          flash("Link copied.");
        },
        function () {
          flash("Copy the address bar to share this puzzle.");
        },
      );
      return;
    }
    flash("Copy the address bar to share this puzzle.");
  }

  window.addEventListener("popstate", function () {
    const params = readParams();
    openPuzzle(
      params.rows,
      params.cols,
      params.difficulty,
      params.seed || randomSeed(),
      "replace",
    );
  });

  const params = readParams();
  openPuzzle(
    params.rows,
    params.cols,
    params.difficulty,
    params.seed || randomSeed(),
    "replace",
  );
})();
