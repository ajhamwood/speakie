// Speakie is a speech recogniser.
//   Events: start(), error(event), end(), soundstart(), soundend(), speechstart(), speechend(),
//     hear(utterList), hear-words(utterance, command, utterList), hear-no-words(utterList),
//     error-network(event), error-permission-blocked(event), error-permission-denied(event)

var Speakie = (function () {

  function hear (utterList) {
    var utterance, syntax, result, params;
    this.emit("hear", utterList);
    p.debug && console.log("Heard:");
    for (var utterance of utterList) {
      utterance = utterance.trim();
      p.debug && console.log("    " + utterance);
      for (var [command, syntax] of p.syntaxes) {
        if (result = syntax.interpretation.exec(utterance)) {
          params = result.slice(1);
          p.debug && console.log("Understood: " + command.text + (params.length ? " , with data: " + params : ""));
          this.emit("hear-words", utterance, command.text, utterList);
          return syntax.fns.forEach(fn => fn.call(this, params));
        }
      }
    };
    this.emit("hear-no-words", utterList)
  }

  function know (command) {
    // Adapted from https://github.com/TalAter/annyang
    // - Splat: "Show me *stuff" -> returns everything heard after the greedy splat (*)
    // - Named: "Give :stuff please" -> returns one word heard in the named (:) position
    // - Optional: "Do you like stuff (and things)" -> matches with or without hearing the optional ((...)) part
    command = command
      .replace(/[\-{}\[\]+?.,\\\^$|#]/g, "\\$&")    // Escape regexp
      .replace(/([^():*\s])/g, match => "\\u" + match.charCodeAt().toString(16).padStart(4, "0")) // Escape unicode
      .replace(/\s*\((.*?)\)\s*/g, "(?:$1)?")       // Optional parameter
      .replace(/(\(\?)?:(?:\\u[\da-f]{4})+/g, (match, optional) => optional ? match : "([^\\s]+)") // Named parameter
      .replace(/\*\S+/g, "(.*?)")                   // Splat parameter
      .replace(/(\(\?:[^)]+\))\?/g, "\\s*$1?\\s*"); // Optional regexp
    return new RegExp(`^${command}$`, "i");
  }

  // Constructor function
  // - Used like so: var speakie = new Speakie({lang: "en", debug: true, continuous: false})
  function Speakie (options = {}) {
    var self = this,
        Recog = ["", "webkit", "moz", "ms", "o"].reduce((a, v) => a || window[v + "SpeechRecognition"], 0);
    if (!Recog) return null;
    options = Object.assign({lang: "en", debug: false, continuous: false}, options);

    // Private properties
    p = {
      events: {},
      syntaxes: new Map(),
      debug: options.debug,
      lastStartedAt: -Infinity,
      autoRestart: true,
      active: false,
      recog: Object.assign(new Recog(), {
        maxAlternatives: 5,
        lang: options.lang,
        continuous: options.continuous,
        onstart: () => this.emit("start"),
        onsoundstart: () => this.emit("soundstart"),
        onsoundend: () => this.emit("soundend"),
        onspeechstart: () => this.emit("speechstart"),
        onspeechend: () => this.emit("speechend"),
        onerror: event => {
          this.emit("error", event);
          p.active = false;
          switch (event.error) {
            case "network": this.emit("error-network", event) ;break;
            case "not-allowed":
            case "service-not-allowed":
            p.autoRestart = false;
            this.emit("error-permission-" + new Date().getTime() - lastStartedAt < 200 ? "blocked" : "denied", event)
          }
        },
        onend: () => {
          this.emit("end");
          if (p.autoRestart) {
            let t = new Date().getTime() - p.lastStartedAt;
            t < 1000 ? setTimeout(() => p.autoRestart || this.start(), 1000 - t) : this.start();
          }
        },
        onresult: event => {
          hear.call(this, [...event.results[event.resultIndex][Symbol.iterator]()].map(x => x.transcript))
        },
        onnomatch: () => this.emit("hear-no-words")
      }),
      voice: null,
      i18n: {},
      i18nword: {}
    };


    // Speech synthesis
    // - Used like so: voicie = new speakie.Voicie(); voicie.say("hey")

    function Voicie () { p.voice = window.speechSynthesis.getVoices().find(a => a.lang.indexOf(p.recog.lang) == 0) }
    Voicie.prototype = {
      say: function (text) {
        if (text.constructor.name == "I18nWord") text = text.text;
        var Utterance = ["", "webkit", "moz", "ms", "o"].reduce((a, v) => a || window[v + "SpeechSynthesisUtterance"], 0),
            utterance = new Utterance(text);
        Object.assign(utterance, { voice: p.voice, pitch: 1, rate: 1 });
        window.speechSynthesis.speak(utterance)
      },
      constructor: Voicie
    };
    this.Voicie = new Proxy(Voicie, { construct (con, args) {
      p = priv.get(self); var obj = new con(...args);
      return new Proxy(obj, { get (obj, key) {
        p = priv.get(self); return obj[key]
      }})
    }});


    // Internationalisation
    // - Constructed with one parameter of the form: {word: {en: "Word", "ja-JP": "言葉" ...} ...}
    // - Used like so: var i18n = new speakie.I18n({...}); i18n.word // "Word"

    function I18n (o) {
      p.i18n = o;
      for (let word in o) p.i18n[word] = new self.I18nWord(p.i18n[word])
    }
    I18n.prototype.constructor = I18n;
    this.I18n = new Proxy(I18n, { construct (con, args) {
      p = priv.get(self); var obj = new con(...args); priv.set(obj, p.i18n);
      return new Proxy(obj, { get (obj, key) {
        p = priv.get(self); p.i18n = priv.get(obj); return p.i18n[key]
      }})
    }});

    // - Constructed with one parameter of the form: {en: "Word", "ja-JP": "言葉" ...}
    function I18nWord (o) { p.i18nword = o }
    I18nWord.prototype = {
      get text() { return Object.entries(p.i18nword).find(e => e[0].indexOf(p.recog.lang) >= 0)[1] },
      set text(_) { return false },
      constructor: I18nWord
    };
    this.I18nWord = new Proxy(I18nWord, { construct (con, args) {
      p = priv.get(self); var obj = new con(...args); priv.set(obj, p.i18nword);
      return new Proxy(obj, { get (obj, key) {
         p = priv.get(self); p.i18nword = priv.get(obj); return obj[key]
      }})
    }})

  }

  // Prototype object
  Speakie.prototype = {
    // Listen for events
    // - Use a named function at .on() to remove with .stop()
    on: function (event, fn) { (p.events[event] = p.events[event] || []).push(fn) },
    emit: function (event, ...args) { p.events[event] && p.events[event].forEach(fn => fn.apply(this, args)) },
    stop: function (event, fname = "") { p.events[event].splice(p.events[event].findIndex(fn => fn.name == fname), 1) },

    start: function () {
      p.lastStartedAt = new Date().getTime();
      p.autoRestart = true;
      p.active = true;
      p.recog.start()
    },
    abort: function () {
      p.autoRestart = false;
      p.active = false;
      this.emit("end");
      p.recog.abort()
    },

    // Set the language for all Speakie objects
    get lang () { return p.recog.lang },
    set lang (val) {
      if (p) {
        p.recog.lang = val;
        p.recog.stop();
        p.syntaxes = new Map([...p.syntaxes].map(([command, syntax]) => {
          command.lang = val;
          syntax.interpretation = command.text.constructor.name === "RegExp" ? command.text : know(command.text);
          return [command, syntax]
        }));
        p.voice = window.speechSynthesis.getVoices().find(a => a.lang.indexOf(val) == 0) || p.voice;
        for (let word in p.i18n) p.i18n[word].lang = val
        return val
      }
    },
    get active () { return p.active }, set active (_) { return false },

    // Listen for utterances
    // - Use a named function at .learn() to remove with .forget()
    learn: function (command, fn) {
      var interpretation = command.text.constructor.name === "RegExp" ? command.text : know(command.text);
      var syntax = p.syntaxes.get(command) || {interpretation, fns: []};
      p.syntaxes.set(command, syntax);
      syntax.fns.push(fn);
      p.debug && console.log("Learned: " + command.text + (fn.name ? " , listener: " + fn.name : ""))
    },
    hear: function (utter) {
      if (utter.constructor.name == "I18nWord") utter = utter.text;
      hear.call(this, Array.isArray(utter) ? utter : [utter])
    },
    forget: function (command, fname = "") {
      var syntax = p.syntaxes.get(command);
      syntax.fns.splice(syntax.fns.findIndex(fn => fn.name == fname), 1);
      p.debug && console.log("Unlearned: " + command.text + (fname ? " , listener: " + fname : ""))
    },

    // TODO: NOT CORRECT voiceschanged and voiceReady are racing
    voiceReady: function () { return new Promise(resolve => window.speechSynthesis.onvoiceschanged = () => resolve()) },

    constructor: Speakie
  };

  // Create private properties
  var p = {}, priv = new WeakMap();
  return new Proxy(Speakie, { construct (con, args) {
    var obj = new con(...args); priv.set(obj, p);
    return new Proxy(obj, { get (obj, key) {
      p = priv.get(obj); return obj[key]
    }})
  }})

})();
