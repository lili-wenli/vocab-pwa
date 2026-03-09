// 艾宾浩斯复习间隔（天）：第 0 天、1 天、3 天、7 天、14 天、30 天
var INTERVALS = [0, 1, 3, 7, 14, 30];
var STORAGE_KEY = "vocabWords";
var MAX_NEW_PER_DAY = 20;

// 获取今天的日期字符串 YYYY-MM-DD
function getToday() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// 从 localStorage 读取所有单词
function getWords() {
  var raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

// 保存单词到 localStorage
function setWords(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

// 日期加 N 天，返回 YYYY-MM-DD
function addDays(dateStr, days) {
  var d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// 是否已掌握（兼容旧数据：无 mastered 视为 false）
function isMastered(word) {
  return word.mastered === true;
}

// 今日新词数量（用于限制每天最多 20 个，按创建日期统计）
function getTodayNewCount() {
  var today = getToday();
  return getWords().filter(function (w) { return w.createdDate === today; }).length;
}

// 免费词典 API（Free Dictionary API）
var DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// 从词典 API 获取数据：音标、例句、音频 URL、同义词
function fetchDictionary(word) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", DICT_API + encodeURIComponent(word.trim()));
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          var entry = Array.isArray(data) ? data[0] : data;
          var phonetic = "";
          var example = "";
          var audioUrl = "";
          if (entry.phonetic) phonetic = entry.phonetic;
          else if (entry.phonetics && entry.phonetics[0]) phonetic = entry.phonetics[0].text || "";
          if (entry.phonetics) {
            for (var i = 0; i < entry.phonetics.length; i++) {
              if (entry.phonetics[i].audio) {
                audioUrl = entry.phonetics[i].audio;
                break;
              }
            }
          }
          var synonyms = [];
          var seen = {};
          if (entry.meanings) {
            for (var m = 0; m < entry.meanings.length; m++) {
              var meaning = entry.meanings[m];
              var list = meaning.synonyms || [];
              for (var s = 0; s < list.length; s++) {
                var sy = list[s].trim().toLowerCase();
                if (sy && sy !== entry.word.toLowerCase() && !seen[sy] && synonyms.length < 5) {
                  seen[sy] = true;
                  synonyms.push(list[s].trim());
                }
              }
              var defs = meaning.definitions || [];
              for (var d = 0; d < defs.length; d++) {
                if (defs[d].example) example = defs[d].example;
                var defSyns = defs[d].synonyms || [];
                for (var s = 0; s < defSyns.length; s++) {
                  var sy = defSyns[s].trim().toLowerCase();
                  if (sy && sy !== entry.word.toLowerCase() && !seen[sy] && synonyms.length < 5) {
                    seen[sy] = true;
                    synonyms.push(defSyns[s].trim());
                  }
                }
              }
              if (example) break;
            }
          }
          resolve({ phonetic: phonetic, example: example, audioUrl: audioUrl, synonyms: synonyms });
        } catch (e) {
          reject(e);
        }
      } else {
        reject(new Error("API error " + xhr.status));
      }
    };
    xhr.onerror = function () { reject(new Error("Network error")); };
    xhr.send();
  });
}

// 规则生成简单例句（无 API 例句时使用，短句、自然）
function generateExample(word) {
  var w = word.trim();
  if (!w) return "";
  var templates = [
    "I like " + w + ".",
    "This is " + w + ".",
    "She has a " + w + ".",
    "We use " + w + " every day.",
    "He wants " + w + "."
  ];
  var idx = 0;
  for (var i = 0; i < w.length; i++) idx += w.charCodeAt(i);
  return templates[idx % templates.length];
}

// 添加新词
// english: 英文；phonetic: 音标；chinese: 中文释义
// example: 例句；exampleTranslation: 例句中文；synonyms: 同义词数组；audioUrl: 发音音频地址（可选）
function addWord(english, phonetic, chinese, example, exampleTranslation, synonyms, audioUrl) {
  var words = getWords();
  var today = getToday();
  if (getTodayNewCount() >= MAX_NEW_PER_DAY) return false;
  var synList = Array.isArray(synonyms) ? synonyms.slice(0, 5) : [];
  var word = {
    id: Date.now(),
    english: english.trim(),
    phonetic: (phonetic || "").trim(),
    chinese: chinese.trim(),
    example: (example || "").trim(),
    exampleTranslation: (exampleTranslation || "").trim(),
    synonyms: synList,
    audioUrl: (audioUrl || "").trim(),
    createdDate: today,
    reviewStage: 0,
    nextReviewDate: today
  };
  words.push(word);
  setWords(words);
  return true;
}

// 检测浏览器是否支持语音合成
function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

// 播放发音：优先使用音频 URL，失败或没有时用浏览器语音合成
function speak(text, audioUrl) {
  if (!text) return;

  // 1. 尝试使用在线音频
  if (audioUrl) {
    try {
      var audio = new Audio(audioUrl);
      audio.play().catch(function () {
        // 如果播放失败，回退到语音合成
        if (isSpeechSupported()) {
          var uFallback = new SpeechSynthesisUtterance(text);
          uFallback.lang = "en-US";
          speechSynthesis.speak(uFallback);
        }
      });
      return;
    } catch (e) {
      // 创建 Audio 失败时也回退
    }
  }

  // 2. 没有音频或失败时，使用语音合成
  if (!isSpeechSupported()) {
    alert("当前浏览器不支持语音朗读，请尝试使用 Chrome 或 Edge 打开此页面。");
    return;
  }
  var u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  speechSynthesis.speak(u);
}

// 「我记得」：进入下一复习阶段，更新下次复习日，并记录今日已复习（用于进度）
function markRemembered(id) {
  var words = getWords();
  var today = getToday();
  for (var i = 0; i < words.length; i++) {
    if (words[i].id === id) {
      var nextStage = Math.min(words[i].reviewStage + 1, INTERVALS.length - 1);
      words[i].reviewStage = nextStage;
      words[i].nextReviewDate = addDays(today, INTERVALS[nextStage]);
      words[i].lastReviewedDate = today;
      setWords(words);
      break;
    }
  }
  render();
}

// 「我忘了」：退回上一阶段（不低于 0），重新计算下次复习日
function markForgot(id) {
  var words = getWords();
  var today = getToday();
  for (var i = 0; i < words.length; i++) {
    if (words[i].id === id) {
      var newStage = Math.max(0, words[i].reviewStage - 1);
      words[i].reviewStage = newStage;
      words[i].nextReviewDate = addDays(today, INTERVALS[newStage]);
      setWords(words);
      break;
    }
  }
  render();
}

// 「已掌握」：标记为已掌握，不再参与复习队列
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

// 恢复：取消已掌握，放回今日待复习
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

// 渲染一个单词卡片；isReview 为 true 时（今日待复习）默认隐藏释义和例句，显示「显示释义」按钮
function renderCard(word, opts) {
  opts = opts || {};
  var isReview = opts.isReview === true;
  var div = document.createElement("div");
  div.className = "word-card" + (isReview ? " word-card--review" : "");
  var phonetic = (word.phonetic || "").trim();
  var enBlock =
    "<div class=\"en-row\">" +
    "<span class=\"en\">" + escapeHtml(word.english) + "</span>" +
    "<button class=\"btn-speak-icon\" type=\"button\" title=\"朗读\" aria-label=\"朗读\">🔊</button>" +
    "</div>" +
    (phonetic ? "<p class=\"phonetic\">" + escapeHtml(phonetic) + "</p>" : "");
  var syns = word.synonyms && word.synonyms.length ? word.synonyms : [];
  var synHtml = syns.length
    ? "<p class=\"synonyms\"><span class=\"synonyms-label\">同义词</span> " + syns.map(function (s) { return escapeHtml(s); }).join(", ") + "</p>"
    : "";
  var exampleTranslation = (word.exampleTranslation || "").trim();
  var exampleTranslationHtml = exampleTranslation ? "<p class=\"example-translation\">" + escapeHtml(exampleTranslation) + "</p>" : "";
  div.innerHTML =
    enBlock +
    "<p class=\"zh\">" + escapeHtml(word.chinese) + "</p>" +
    (word.example ? "<p class=\"example\">" + escapeHtml(word.example) + "</p>" : "") +
    exampleTranslationHtml +
    synHtml +
    (isReview ? "<button class=\"btn-show-meaning\" type=\"button\">显示释义</button>" : "") +
    "<p class=\"meta\">创建于 " + word.createdDate + " · 阶段 " + word.reviewStage + " · 下次复习 " + word.nextReviewDate + "</p>" +
    "<div class=\"actions\">" +
    "<button class=\"btn-speak\" type=\"button\">🔊 朗读</button>" +
    "<button class=\"btn-remembered\" type=\"button\">✓ I remembered</button>" +
    "<button class=\"btn-forgot\" type=\"button\">✗ I forgot</button>" +
    "<button class=\"btn-master\" type=\"button\">★ Mastered</button>" +
    "</div>";
  div.querySelector(".btn-speak-icon").onclick = function () { speak(word.english, word.audioUrl); };
  div.querySelector(".btn-speak").onclick = function () { speak(word.english, word.audioUrl); };
  div.querySelector(".btn-remembered").onclick = function () { markRemembered(word.id); };
  div.querySelector(".btn-forgot").onclick = function () { markForgot(word.id); };
  div.querySelector(".btn-master").onclick = function () { markMastered(word.id); };
  if (isReview) {
    var btnShow = div.querySelector(".btn-show-meaning");
    btnShow.onclick = function () {
      div.classList.add("word-card--meaning-visible");
      btnShow.style.display = "none";
    };
  }
  return div;
}

function escapeHtml(text) {
  var span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}

// 更新今日复习进度（待复习数、已复习数、进度条；不含已掌握）
function updateReviewProgress() {
  var today = getToday();
  var words = getWords().filter(function (w) { return !isMastered(w); });
  var dueToday = words.filter(function (w) { return w.nextReviewDate === today; }).length;
  var reviewedToday = words.filter(function (w) { return w.lastReviewedDate === today; }).length;
  var total = dueToday + reviewedToday;
  var percent = total > 0 ? Math.round((reviewedToday / total) * 100) : 0;

  document.getElementById("dueCount").textContent = dueToday;
  document.getElementById("reviewedCount").textContent = reviewedToday;
  var fill = document.getElementById("progressFill");
  fill.style.width = percent + "%";
  fill.parentNode.setAttribute("aria-valuenow", percent);
}

// 渲染已掌握单词的简洁卡片（仅展示 + 恢复）
function renderMasteredCard(word) {
  var div = document.createElement("div");
  div.className = "word-card word-card--mastered";
  var phonetic = (word.phonetic || "").trim();
  var syns = word.synonyms && word.synonyms.length ? word.synonyms : [];
  var synHtml = syns.length
    ? "<p class=\"synonyms\"><span class=\"synonyms-label\">同义词</span> " + syns.map(function (s) { return escapeHtml(s); }).join(", ") + "</p>"
    : "";
  div.innerHTML =
    "<div class=\"en-row\">" +
    "<span class=\"en\">" + escapeHtml(word.english) + "</span>" +
    "<button class=\"btn-speak-icon\" type=\"button\" title=\"朗读\" aria-label=\"朗读\">🔊</button>" +
    "</div>" +
    (phonetic ? "<p class=\"phonetic\">" + escapeHtml(phonetic) + "</p>" : "") +
    "<p class=\"zh\">" + escapeHtml(word.chinese) + "</p>" +
    synHtml +
    "<button class=\"btn-restore\" type=\"button\">恢复学习</button>";
  div.querySelector(".btn-speak-icon").onclick = function () { speak(word.english, word.audioUrl); };
  div.querySelector(".btn-restore").onclick = function () { restoreWord(word.id); };
  return div;
}

// 渲染整个页面
function render() {
  var today = getToday();
  var words = getWords();
  var newWords = words.filter(function (w) { return w.createdDate === today && !isMastered(w); });
  var reviewWords = words.filter(function (w) { return w.nextReviewDate === today && !isMastered(w); });
  var masteredWords = words.filter(function (w) { return isMastered(w); });

  document.getElementById("todayCount").textContent = getTodayNewCount();
  updateReviewProgress();

  var newList = document.getElementById("newWordsList");
  newList.innerHTML = "";
  if (newWords.length === 0) {
    newList.appendChild(document.createElement("p")).className = "empty-hint";
    newList.querySelector("p").textContent = "今天还没有添加新词，在上方表单添加吧～";
  } else {
    newWords.forEach(function (w) { newList.appendChild(renderCard(w)); });
  }

  var reviewList = document.getElementById("reviewWordsList");
  reviewList.innerHTML = "";
  if (reviewWords.length === 0) {
    reviewList.appendChild(document.createElement("p")).className = "empty-hint";
    reviewList.querySelector("p").textContent = "今天没有需要复习的单词";
  } else {
    reviewWords.forEach(function (w) { reviewList.appendChild(renderCard(w, { isReview: true })); });
  }

  var masteredList = document.getElementById("masteredWordsList");
  masteredList.innerHTML = "";
  if (masteredWords.length === 0) {
    masteredList.appendChild(document.createElement("p")).className = "empty-hint";
    masteredList.querySelector("p").textContent = "暂无已掌握的单词";
  } else {
    masteredWords.forEach(function (w) { masteredList.appendChild(renderMasteredCard(w)); });
  }
}

// 上次查词结果（用于添加时带入同义词和音频 URL）
var lastLookupData = { english: "", synonyms: [], audioUrl: "" };

// 查词按钮：从词典 API 获取并填充音标、例句、同义词；无例句时用规则生成
document.getElementById("lookupBtn").onclick = function () {
  var english = document.getElementById("english").value.trim();
  if (!english) {
    alert("请先输入英文单词");
    return;
  }
  var btn = document.getElementById("lookupBtn");
  btn.disabled = true;
  btn.textContent = "查询中…";
  lastLookupData = { english: "", synonyms: [], audioUrl: "" };
  fetchDictionary(english)
    .then(function (data) {
      var phonetic = (data.phonetic || "").trim();
      var example = (data.example || "").trim();
      if (!example) example = generateExample(english);
      document.getElementById("phonetic").value = phonetic;
      document.getElementById("example").value = example;
      lastLookupData = { english: english, synonyms: data.synonyms || [], audioUrl: data.audioUrl || "" };
    })
    .catch(function () {
      var example = generateExample(english);
      document.getElementById("example").value = example;
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = "查词";
    });
};

// 表单提交：添加新词
document.getElementById("addWordForm").onsubmit = function (e) {
  e.preventDefault();
  var english = document.getElementById("english").value.trim();
  var phonetic = document.getElementById("phonetic").value;
  var chinese = document.getElementById("chinese").value;
  var example = document.getElementById("example").value;
  var exampleTranslation = document.getElementById("exampleTranslation").value;
  var useLookup = lastLookupData.english === english;
  var synonyms = (useLookup ? lastLookupData.synonyms : []) || [];
  var audioUrl = useLookup ? lastLookupData.audioUrl : "";
  if (getTodayNewCount() >= MAX_NEW_PER_DAY) {
    alert("今日已添加 20 个新词，明天再继续吧～");
    return;
  }
  if (addWord(english, phonetic, chinese, example, exampleTranslation, synonyms, audioUrl)) {
    document.getElementById("english").value = "";
    document.getElementById("phonetic").value = "";
    document.getElementById("chinese").value = "";
    document.getElementById("example").value = "";
    document.getElementById("exampleTranslation").value = "";
    lastLookupData = { english: "", synonyms: [], audioUrl: "" };
    render();
  }
};

// 首次加载时渲染
render();
