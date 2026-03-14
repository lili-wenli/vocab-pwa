// Ebbinghaus review intervals (days): 0, 1, 3, 7, 14, 30
var INTERVALS = [0, 1, 3, 7, 14, 30];
var STORAGE_KEY = "vocabWords";
var MAX_NEW_PER_DAY = 20;

// Today's date as YYYY-MM-DD
function getToday() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Normalize date string to YYYY-MM-DD; return null if invalid
function normalizeDateStr(str) {
  if (!str || typeof str !== "string") return null;
  str = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  var d = new Date(str + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// True if word should appear in "Words to review today" (due today or overdue; missing date = due now)
function isDueForReview(word, today) {
  var next = normalizeDateStr(word.nextReviewDate);
  if (next === null) return true;
  return next <= today;
}

// Load all words from localStorage; never lose data
function getWords() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function setWords(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

// Add days to a date string; invalid date falls back to today
function addDays(dateStr, days) {
  var today = getToday();
  var d = new Date((dateStr || today) + "T12:00:00");
  if (isNaN(d.getTime())) d = new Date();
  d.setDate(d.getDate() + (typeof days === "number" ? days : 0));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function isMastered(word) {
  return word.mastered === true;
}

// Count words created today (for the 20-per-day limit)
function getTodayNewCount() {
  var today = getToday();
  return getWords().filter(function (w) {
    var created = normalizeDateStr(w.createdDate);
    return created === today;
  }).length;
}

// Add one word. Only required fields: english, chinese. Rest are set here.
function addWord(english, chinese) {
  var words = getWords();
  var today = getToday();
  if (getTodayNewCount() >= MAX_NEW_PER_DAY) return false;
  var word = {
    id: Date.now(),
    english: String(english).trim(),
    chinese: String(chinese).trim(),
    createdDate: today,
    reviewStage: 0,
    nextReviewDate: today,
    mastered: false
  };
  words.push(word);
  setWords(words);
  return true;
}

// I remembered: move to next stage and set next review date
function markRemembered(id) {
  var words = getWords();
  var today = getToday();
  for (var i = 0; i < words.length; i++) {
    if (words[i].id === id) {
      var nextStage = Math.min(words[i].reviewStage + 1, INTERVALS.length - 1);
      words[i].reviewStage = nextStage;
      words[i].nextReviewDate = addDays(today, INTERVALS[nextStage]);
      setWords(words);
      break;
    }
  }
  render();
}

// I forgot: move back one stage (min 0), recalc next review date
function markForgot(id) {
  var words = getWords();
  var today = getToday();
  for (var i = 0; i < words.length; i++) {
    if (words[i].id === id) {
      var newStage = Math.max(0, (words[i].reviewStage || 0) - 1);
      words[i].reviewStage = newStage;
      words[i].nextReviewDate = addDays(today, INTERVALS[newStage]);
      setWords(words);
      break;
    }
  }
  render();
}

// Mastered: mark as mastered (stays in storage, hidden from active review)
function markMastered(id) {
  var words = getWords();
  for (var i = 0; i < words.length; i++) {
    if (words[i].id === id) {
      words[i].mastered = true;
      setWords(words);
      break;
    }
  }
  render();
}

// Restore from mastered: back to active, due today
function restoreWord(id) {
  var words = getWords();
  var today = getToday();
  for (var i = 0; i < words.length; i++) {
    if (words[i].id === id) {
      words[i].mastered = false;
      words[i].nextReviewDate = today;
      setWords(words);
      break;
    }
  }
  render();
}

function escapeHtml(text) {
  var span = document.createElement("span");
  span.textContent = text == null ? "" : String(text);
  return span.innerHTML;
}

// One review card: show meaning by default for simplicity
function renderCard(word, isReview) {
  var div = document.createElement("div");
  div.className = "word-card" + (isReview ? " word-card--review" : "");
  div.innerHTML =
    "<p class=\"en\">" + escapeHtml(word.english) + "</p>" +
    "<p class=\"zh\">" + escapeHtml(word.chinese) + "</p>" +
    "<p class=\"meta\">Created " + escapeHtml(word.createdDate) + " · Stage " + (word.reviewStage || 0) + " · Next " + escapeHtml(word.nextReviewDate) + "</p>" +
    "<div class=\"actions\">" +
    "<button type=\"button\" class=\"btn btn-remembered\">I remembered</button>" +
    "<button type=\"button\" class=\"btn btn-forgot\">I forgot</button>" +
    "<button type=\"button\" class=\"btn btn-master\">Mastered</button>" +
    "</div>";
  div.querySelector(".btn-remembered").onclick = function () { markRemembered(word.id); };
  div.querySelector(".btn-forgot").onclick = function () { markForgot(word.id); };
  div.querySelector(".btn-master").onclick = function () { markMastered(word.id); };
  return div;
}

function renderMasteredCard(word) {
  var div = document.createElement("div");
  div.className = "word-card word-card--mastered";
  div.innerHTML =
    "<p class=\"en\">" + escapeHtml(word.english) + "</p>" +
    "<p class=\"zh\">" + escapeHtml(word.chinese) + "</p>" +
    "<button type=\"button\" class=\"btn btn-restore\">Restore to review</button>";
  div.querySelector(".btn-restore").onclick = function () { restoreWord(word.id); };
  return div;
}

function render() {
  var today = getToday();
  var words = getWords();

  var newWords = words.filter(function (w) {
    return !isMastered(w) && normalizeDateStr(w.createdDate) === today;
  });
  var reviewWords = words.filter(function (w) {
    return !isMastered(w) && isDueForReview(w, today);
  });
  var masteredWords = words.filter(function (w) { return isMastered(w); });

  document.getElementById("todayCount").textContent = getTodayNewCount();

  var newList = document.getElementById("newWordsList");
  newList.innerHTML = "";
  if (newWords.length === 0) {
    var p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "No new words added today.";
    newList.appendChild(p);
  } else {
    newWords.forEach(function (w) { newList.appendChild(renderCard(w, false)); });
  }

  var reviewList = document.getElementById("reviewWordsList");
  reviewList.innerHTML = "";
  if (reviewWords.length === 0) {
    var p2 = document.createElement("p");
    p2.className = "empty-hint";
    p2.textContent = "No words due for review today.";
    reviewList.appendChild(p2);
  } else {
    reviewWords.forEach(function (w) { reviewList.appendChild(renderCard(w, true)); });
  }

  var masteredList = document.getElementById("masteredWordsList");
  masteredList.innerHTML = "";
  if (masteredWords.length === 0) {
    var p3 = document.createElement("p");
    p3.className = "empty-hint";
    p3.textContent = "No mastered words yet.";
    masteredList.appendChild(p3);
  } else {
    masteredWords.forEach(function (w) { masteredList.appendChild(renderMasteredCard(w)); });
  }
}

document.getElementById("addWordForm").onsubmit = function (e) {
  e.preventDefault();
  var english = document.getElementById("english").value.trim();
  var chinese = document.getElementById("chinese").value.trim();
  if (getTodayNewCount() >= MAX_NEW_PER_DAY) {
    alert("You can add up to 20 new words per day. Try again tomorrow.");
    return;
  }
  if (addWord(english, chinese)) {
    document.getElementById("english").value = "";
    document.getElementById("chinese").value = "";
    render();
  }
};

render();
