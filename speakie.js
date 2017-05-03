// Speakie is a speech recogniser.
//   Events: start(), error(event), end(), soundstart(), soundend(), speechstart(), speechend(),
//     hear(utterList), hear-words(utterance, command, utterList), hear-no-words(utterList),
//     error-network(event), error-permission-blocked(event), error-permission-denied(event)

var Speakie = (function () {

  function hear (utterList) {
    var utterance, syntax, result, params;
    this.emit("hear", utterList);
    (_ = this._).debug && console.log("Heard:");
    for (var utterance of utterList) {
      utterance = utterance.trim();
      _.debug && console.log("    " + utterance);
      for (var [command, syntax] of _.syntaxes) {
        if (result = syntax.interpretation.exec(utterance)) {
          params = result.slice(1);
          _.debug && console.log("Understood: " + command.text + (params.length ? " , with data: " + params : ""));
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

    // "Private" properties
    var _ = this._ = {
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
          _.active = false;
          switch (event.error) {
            case "network": this.emit("error-network", event) ;break;
            case "not-allowed":
            case "service-not-allowed":
            _.autoRestart = false;
            this.emit("error-permission-" + new Date().getTime() - _.lastStartedAt < 200 ? "blocked" : "denied", event)
          }
        },
        onend: () => {
          this.emit("end");
          if (_.autoRestart) {
            let t = new Date().getTime() - _.lastStartedAt;
            t < 1000 ? setTimeout(() => _.autoRestart || this.start(), 1000 - t) : this.start();
          }
        },
        onresult: event => {
          hear.call(this, [...event.results[event.resultIndex][Symbol.iterator]()].map(x => x.transcript))
        },
        onnomatch: () => this.emit("hear-no-words")
      }),
      voice: null
    };


    // Speech synthesis
    // - Used like so: voicie = new speakie.Voicie(); voicie.say("hey")

    function Voicie () { self._.voice = window.speechSynthesis.getVoices().find(a => a.lang.indexOf(self._.recog.lang) == 0) }
    Voicie.prototype = {
      say: function (text) {
        if (text.constructor.name == "I18nWord") text = text.text;
        var Utterance = ["", "webkit", "moz", "ms", "o"].reduce((a, v) => a || window[v + "SpeechSynthesisUtterance"], 0),
            utterance = new Utterance(text);
        Object.assign(utterance, { voice: self._.voice, pitch: 1, rate: 1 });
        window.speechSynthesis.speak(utterance)
      },
      constructor: (this.Voicie = Voicie)
    };


    // Internationalisation
    // - Constructed with one parameter of the form: {word: {en: "Word", "ja-JP": "言葉" ...} ...}
    // - Used like so: var i18n = new speakie.I18n({...}); i18n.word // "Word"

    this.I18n = (function () {
      function I18n (o) { for (let word in o) this[word] = new self.I18nWord(o[word]) }
      I18n.prototype.constructor = I18n;
      return I18n
    })();

    // - Constructed with one parameter of the form: {en: "Word", "ja-JP": "言葉" ...}
    this.I18nWord = (function () {
      function I18nWord (o) { for (let lang in o) this[lang] = o[lang] }
      I18nWord.prototype = {
        get text() { return Object.entries(this).find(e => e[0].indexOf(self._.recog.lang) >= 0)[1] },
        set text(v) { return false },
        constructor: I18nWord
      };
      return I18nWord
    })()

  }

  // Prototype object
  Speakie.prototype = {
    // Listen for events
    // - Use a named function at .on() to remove with .stop()
    on: function (event, fn) { (this._.events[event] = this._.events[event] || []).push(fn) },
    emit: function (event, ...args) { this._.events[event] && this._.events[event].forEach(fn => fn.apply(this, args)) },
    stop: function (event, fname = "") { this._.events[event].splice(this._.events[event].findIndex(fn => fn.name == fname), 1) },

    // Turning Speakie on and off
    start: function () {
      (_ = this._).lastStartedAt = new Date().getTime();
      _.autoRestart = true;
      _.active = true;
      _.recog.start()
    },
    abort: function () {
      (_ = this._).autoRestart = false;
      _.active = false;
      this.emit("end");
      _.recog.abort()
    },

    // Set the language for all Speakie objects
    get lang () { return this._.recog.lang },
    set lang (val) {
      (_ = this._).recog.lang = val;
      _.recog.stop();
      _.syntaxes = new Map([..._.syntaxes].map(([command, syntax]) => {
        command.lang = val;
        syntax.interpretation = command.text.constructor.name === "RegExp" ? command.text : know(command.text);
        return [command, syntax]
      }));
      _.voice = window.speechSynthesis.getVoices().find(a => a.lang.indexOf(val) == 0) || _.voice;
      return val
    },
    get active () { return this._.active }, set active (v) { return false },

    // Listen for utterances
    // - Use a named function at .learn() to remove with .forget()
    learn: function (command, fn) {
      var interpretation = command.text.constructor.name === "RegExp" ? command.text : know(command.text);
      var syntax = (_ = this._).syntaxes.get(command) || {interpretation, fns: []};
      _.syntaxes.set(command, syntax);
      syntax.fns.push(fn);
      _.debug && console.log("Learned: " + command.text + (fn.name ? " , listener: " + fn.name : ""))
    },
    hear: function (utter) {
      if (utter.constructor.name == "I18nWord") utter = utter.text;
      hear.call(this, Array.isArray(utter) ? utter : [utter])
    },
    forget: function (command, fname = "") {
      var syntax = this._.syntaxes.get(command);
      syntax.fns.splice(syntax.fns.findIndex(fn => fn.name == fname), 1);
      this._.debug && console.log("Unlearned: " + command.text + (fname ? " , listener: " + fname : ""))
    },

    // TODO: NOT CORRECT voiceschanged and voiceReady are racing
    voiceReady: function () { return new Promise(resolve => window.speechSynthesis.onvoiceschanged = () => resolve()) },

    constructor: Speakie
  };

  var _;
  return Speakie

})();
