"format register";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  function dedupe(deps) {
    var newDeps = [];
    for (var i = 0, l = deps.length; i < l; i++)
      if (indexOf.call(newDeps, deps[i]) == -1)
        newDeps.push(deps[i])
    return newDeps;
  }

  function register(name, deps, declare, execute) {
    if (typeof name != 'string')
      throw "System.register provided no module name";
    
    var entry;

    // dynamic
    if (typeof declare == 'boolean') {
      entry = {
        declarative: false,
        deps: deps,
        execute: execute,
        executingRequire: declare
      };
    }
    else {
      // ES6 declarative
      entry = {
        declarative: true,
        deps: deps,
        declare: declare
      };
    }

    entry.name = name;
    
    // we never overwrite an existing define
    if (!defined[name])
      defined[name] = entry; 

    entry.deps = dedupe(entry.deps);

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }

  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      
      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;
      
      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {
        
        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;
      exports[name] = value;

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          var importerIndex = indexOf.call(importerModule.dependencies, module);
          importerModule.setters[importerIndex](exports);
        }
      }

      module.locked = false;
      return value;
    });
    
    module.setters = declaration.setters;
    module.execute = declaration.execute;

    if (!module.setters || !module.execute)
      throw new TypeError("Invalid System.register form for " + entry.name);

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = { 'default': depEntry.module.exports, __useDefault: true };
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);
    
      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);
    
    if (output)
      module.exports = output;
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    var module = entry.declarative ? entry.module.exports : { 'default': entry.module.exports, '__useDefault': true };

    // return the defined module object
    return modules[name] = module;
  };

  return function(main, declare) {

    var System;

    // if there's a system loader, define onto it
    if (typeof System != 'undefined' && System.register) {
      declare(System);
      System['import'](main);
    }
    // otherwise, self execute
    else {
      declare(System = {
        register: register, 
        get: load, 
        set: function(name, module) {
          modules[name] = module; 
        },
        newModule: function(module) {
          return module;
        },
        global: global 
      });
      System.set('@empty', System.newModule({}));
      load(main);
    }
  };

})(typeof window != 'undefined' ? window : global)
/* ('mainModule', function(System) {
  System.register(...);
}); */

('app/main', function(System) {

(function() {
function define(){};  define.amd = {};
(function(global, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = global.document ? factory(global, true) : function(w) {
      if (!w.document) {
        throw new Error("jQuery requires a window with a document");
      }
      return factory(w);
    };
  } else {
    factory(global);
  }
}(typeof window !== "undefined" ? window : this, function(window, noGlobal) {
  var arr = [];
  var slice = arr.slice;
  var concat = arr.concat;
  var push = arr.push;
  var indexOf = arr.indexOf;
  var class2type = {};
  var toString = class2type.toString;
  var hasOwn = class2type.hasOwnProperty;
  var support = {};
  var document = window.document,
      version = "2.1.3",
      jQuery = function(selector, context) {
        return new jQuery.fn.init(selector, context);
      },
      rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,
      rmsPrefix = /^-ms-/,
      rdashAlpha = /-([\da-z])/gi,
      fcamelCase = function(all, letter) {
        return letter.toUpperCase();
      };
  jQuery.fn = jQuery.prototype = {
    jquery: version,
    constructor: jQuery,
    selector: "",
    length: 0,
    toArray: function() {
      return slice.call(this);
    },
    get: function(num) {
      return num != null ? (num < 0 ? this[num + this.length] : this[num]) : slice.call(this);
    },
    pushStack: function(elems) {
      var ret = jQuery.merge(this.constructor(), elems);
      ret.prevObject = this;
      ret.context = this.context;
      return ret;
    },
    each: function(callback, args) {
      return jQuery.each(this, callback, args);
    },
    map: function(callback) {
      return this.pushStack(jQuery.map(this, function(elem, i) {
        return callback.call(elem, i, elem);
      }));
    },
    slice: function() {
      return this.pushStack(slice.apply(this, arguments));
    },
    first: function() {
      return this.eq(0);
    },
    last: function() {
      return this.eq(-1);
    },
    eq: function(i) {
      var len = this.length,
          j = +i + (i < 0 ? len : 0);
      return this.pushStack(j >= 0 && j < len ? [this[j]] : []);
    },
    end: function() {
      return this.prevObject || this.constructor(null);
    },
    push: push,
    sort: arr.sort,
    splice: arr.splice
  };
  jQuery.extend = jQuery.fn.extend = function() {
    var options,
        name,
        src,
        copy,
        copyIsArray,
        clone,
        target = arguments[0] || {},
        i = 1,
        length = arguments.length,
        deep = false;
    if (typeof target === "boolean") {
      deep = target;
      target = arguments[i] || {};
      i++;
    }
    if (typeof target !== "object" && !jQuery.isFunction(target)) {
      target = {};
    }
    if (i === length) {
      target = this;
      i--;
    }
    for (; i < length; i++) {
      if ((options = arguments[i]) != null) {
        for (name in options) {
          src = target[name];
          copy = options[name];
          if (target === copy) {
            continue;
          }
          if (deep && copy && (jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)))) {
            if (copyIsArray) {
              copyIsArray = false;
              clone = src && jQuery.isArray(src) ? src : [];
            } else {
              clone = src && jQuery.isPlainObject(src) ? src : {};
            }
            target[name] = jQuery.extend(deep, clone, copy);
          } else if (copy !== undefined) {
            target[name] = copy;
          }
        }
      }
    }
    return target;
  };
  jQuery.extend({
    expando: "jQuery" + (version + Math.random()).replace(/\D/g, ""),
    isReady: true,
    error: function(msg) {
      throw new Error(msg);
    },
    noop: function() {},
    isFunction: function(obj) {
      return jQuery.type(obj) === "function";
    },
    isArray: Array.isArray,
    isWindow: function(obj) {
      return obj != null && obj === obj.window;
    },
    isNumeric: function(obj) {
      return !jQuery.isArray(obj) && (obj - parseFloat(obj) + 1) >= 0;
    },
    isPlainObject: function(obj) {
      if (jQuery.type(obj) !== "object" || obj.nodeType || jQuery.isWindow(obj)) {
        return false;
      }
      if (obj.constructor && !hasOwn.call(obj.constructor.prototype, "isPrototypeOf")) {
        return false;
      }
      return true;
    },
    isEmptyObject: function(obj) {
      var name;
      for (name in obj) {
        return false;
      }
      return true;
    },
    type: function(obj) {
      if (obj == null) {
        return obj + "";
      }
      return typeof obj === "object" || typeof obj === "function" ? class2type[toString.call(obj)] || "object" : typeof obj;
    },
    globalEval: function(code) {
      var script,
          indirect = eval;
      code = jQuery.trim(code);
      if (code) {
        if (code.indexOf("use strict") === 1) {
          script = document.createElement("script");
          script.text = code;
          document.head.appendChild(script).parentNode.removeChild(script);
        } else {
          indirect(code);
        }
      }
    },
    camelCase: function(string) {
      return string.replace(rmsPrefix, "ms-").replace(rdashAlpha, fcamelCase);
    },
    nodeName: function(elem, name) {
      return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
    },
    each: function(obj, callback, args) {
      var value,
          i = 0,
          length = obj.length,
          isArray = isArraylike(obj);
      if (args) {
        if (isArray) {
          for (; i < length; i++) {
            value = callback.apply(obj[i], args);
            if (value === false) {
              break;
            }
          }
        } else {
          for (i in obj) {
            value = callback.apply(obj[i], args);
            if (value === false) {
              break;
            }
          }
        }
      } else {
        if (isArray) {
          for (; i < length; i++) {
            value = callback.call(obj[i], i, obj[i]);
            if (value === false) {
              break;
            }
          }
        } else {
          for (i in obj) {
            value = callback.call(obj[i], i, obj[i]);
            if (value === false) {
              break;
            }
          }
        }
      }
      return obj;
    },
    trim: function(text) {
      return text == null ? "" : (text + "").replace(rtrim, "");
    },
    makeArray: function(arr, results) {
      var ret = results || [];
      if (arr != null) {
        if (isArraylike(Object(arr))) {
          jQuery.merge(ret, typeof arr === "string" ? [arr] : arr);
        } else {
          push.call(ret, arr);
        }
      }
      return ret;
    },
    inArray: function(elem, arr, i) {
      return arr == null ? -1 : indexOf.call(arr, elem, i);
    },
    merge: function(first, second) {
      var len = +second.length,
          j = 0,
          i = first.length;
      for (; j < len; j++) {
        first[i++] = second[j];
      }
      first.length = i;
      return first;
    },
    grep: function(elems, callback, invert) {
      var callbackInverse,
          matches = [],
          i = 0,
          length = elems.length,
          callbackExpect = !invert;
      for (; i < length; i++) {
        callbackInverse = !callback(elems[i], i);
        if (callbackInverse !== callbackExpect) {
          matches.push(elems[i]);
        }
      }
      return matches;
    },
    map: function(elems, callback, arg) {
      var value,
          i = 0,
          length = elems.length,
          isArray = isArraylike(elems),
          ret = [];
      if (isArray) {
        for (; i < length; i++) {
          value = callback(elems[i], i, arg);
          if (value != null) {
            ret.push(value);
          }
        }
      } else {
        for (i in elems) {
          value = callback(elems[i], i, arg);
          if (value != null) {
            ret.push(value);
          }
        }
      }
      return concat.apply([], ret);
    },
    guid: 1,
    proxy: function(fn, context) {
      var tmp,
          args,
          proxy;
      if (typeof context === "string") {
        tmp = fn[context];
        context = fn;
        fn = tmp;
      }
      if (!jQuery.isFunction(fn)) {
        return undefined;
      }
      args = slice.call(arguments, 2);
      proxy = function() {
        return fn.apply(context || this, args.concat(slice.call(arguments)));
      };
      proxy.guid = fn.guid = fn.guid || jQuery.guid++;
      return proxy;
    },
    now: Date.now,
    support: support
  });
  jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
    class2type["[object " + name + "]"] = name.toLowerCase();
  });
  function isArraylike(obj) {
    var length = obj.length,
        type = jQuery.type(obj);
    if (type === "function" || jQuery.isWindow(obj)) {
      return false;
    }
    if (obj.nodeType === 1 && length) {
      return true;
    }
    return type === "array" || length === 0 || typeof length === "number" && length > 0 && (length - 1) in obj;
  }
  var Sizzle = (function(window) {
    var i,
        support,
        Expr,
        getText,
        isXML,
        tokenize,
        compile,
        select,
        outermostContext,
        sortInput,
        hasDuplicate,
        setDocument,
        document,
        docElem,
        documentIsHTML,
        rbuggyQSA,
        rbuggyMatches,
        matches,
        contains,
        expando = "sizzle" + 1 * new Date(),
        preferredDoc = window.document,
        dirruns = 0,
        done = 0,
        classCache = createCache(),
        tokenCache = createCache(),
        compilerCache = createCache(),
        sortOrder = function(a, b) {
          if (a === b) {
            hasDuplicate = true;
          }
          return 0;
        },
        MAX_NEGATIVE = 1 << 31,
        hasOwn = ({}).hasOwnProperty,
        arr = [],
        pop = arr.pop,
        push_native = arr.push,
        push = arr.push,
        slice = arr.slice,
        indexOf = function(list, elem) {
          var i = 0,
              len = list.length;
          for (; i < len; i++) {
            if (list[i] === elem) {
              return i;
            }
          }
          return -1;
        },
        booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",
        whitespace = "[\\x20\\t\\r\\n\\f]",
        characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",
        identifier = characterEncoding.replace("w", "w#"),
        attributes = "\\[" + whitespace + "*(" + characterEncoding + ")(?:" + whitespace + "*([*^$|!~]?=)" + whitespace + "*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" + whitespace + "*\\]",
        pseudos = ":(" + characterEncoding + ")(?:\\((" + "('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" + "((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" + ".*" + ")\\)|)",
        rwhitespace = new RegExp(whitespace + "+", "g"),
        rtrim = new RegExp("^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g"),
        rcomma = new RegExp("^" + whitespace + "*," + whitespace + "*"),
        rcombinators = new RegExp("^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*"),
        rattributeQuotes = new RegExp("=" + whitespace + "*([^\\]'\"]*?)" + whitespace + "*\\]", "g"),
        rpseudo = new RegExp(pseudos),
        ridentifier = new RegExp("^" + identifier + "$"),
        matchExpr = {
          "ID": new RegExp("^#(" + characterEncoding + ")"),
          "CLASS": new RegExp("^\\.(" + characterEncoding + ")"),
          "TAG": new RegExp("^(" + characterEncoding.replace("w", "w*") + ")"),
          "ATTR": new RegExp("^" + attributes),
          "PSEUDO": new RegExp("^" + pseudos),
          "CHILD": new RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace + "*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace + "*(\\d+)|))" + whitespace + "*\\)|)", "i"),
          "bool": new RegExp("^(?:" + booleans + ")$", "i"),
          "needsContext": new RegExp("^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" + whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i")
        },
        rinputs = /^(?:input|select|textarea|button)$/i,
        rheader = /^h\d$/i,
        rnative = /^[^{]+\{\s*\[native \w/,
        rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,
        rsibling = /[+~]/,
        rescape = /'|\\/g,
        runescape = new RegExp("\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig"),
        funescape = function(_, escaped, escapedWhitespace) {
          var high = "0x" + escaped - 0x10000;
          return high !== high || escapedWhitespace ? escaped : high < 0 ? String.fromCharCode(high + 0x10000) : String.fromCharCode(high >> 10 | 0xD800, high & 0x3FF | 0xDC00);
        },
        unloadHandler = function() {
          setDocument();
        };
    try {
      push.apply((arr = slice.call(preferredDoc.childNodes)), preferredDoc.childNodes);
      arr[preferredDoc.childNodes.length].nodeType;
    } catch (e) {
      push = {apply: arr.length ? function(target, els) {
          push_native.apply(target, slice.call(els));
        } : function(target, els) {
          var j = target.length,
              i = 0;
          while ((target[j++] = els[i++])) {}
          target.length = j - 1;
        }};
    }
    function Sizzle(selector, context, results, seed) {
      var match,
          elem,
          m,
          nodeType,
          i,
          groups,
          old,
          nid,
          newContext,
          newSelector;
      if ((context ? context.ownerDocument || context : preferredDoc) !== document) {
        setDocument(context);
      }
      context = context || document;
      results = results || [];
      nodeType = context.nodeType;
      if (typeof selector !== "string" || !selector || nodeType !== 1 && nodeType !== 9 && nodeType !== 11) {
        return results;
      }
      if (!seed && documentIsHTML) {
        if (nodeType !== 11 && (match = rquickExpr.exec(selector))) {
          if ((m = match[1])) {
            if (nodeType === 9) {
              elem = context.getElementById(m);
              if (elem && elem.parentNode) {
                if (elem.id === m) {
                  results.push(elem);
                  return results;
                }
              } else {
                return results;
              }
            } else {
              if (context.ownerDocument && (elem = context.ownerDocument.getElementById(m)) && contains(context, elem) && elem.id === m) {
                results.push(elem);
                return results;
              }
            }
          } else if (match[2]) {
            push.apply(results, context.getElementsByTagName(selector));
            return results;
          } else if ((m = match[3]) && support.getElementsByClassName) {
            push.apply(results, context.getElementsByClassName(m));
            return results;
          }
        }
        if (support.qsa && (!rbuggyQSA || !rbuggyQSA.test(selector))) {
          nid = old = expando;
          newContext = context;
          newSelector = nodeType !== 1 && selector;
          if (nodeType === 1 && context.nodeName.toLowerCase() !== "object") {
            groups = tokenize(selector);
            if ((old = context.getAttribute("id"))) {
              nid = old.replace(rescape, "\\$&");
            } else {
              context.setAttribute("id", nid);
            }
            nid = "[id='" + nid + "'] ";
            i = groups.length;
            while (i--) {
              groups[i] = nid + toSelector(groups[i]);
            }
            newContext = rsibling.test(selector) && testContext(context.parentNode) || context;
            newSelector = groups.join(",");
          }
          if (newSelector) {
            try {
              push.apply(results, newContext.querySelectorAll(newSelector));
              return results;
            } catch (qsaError) {} finally {
              if (!old) {
                context.removeAttribute("id");
              }
            }
          }
        }
      }
      return select(selector.replace(rtrim, "$1"), context, results, seed);
    }
    function createCache() {
      var keys = [];
      function cache(key, value) {
        if (keys.push(key + " ") > Expr.cacheLength) {
          delete cache[keys.shift()];
        }
        return (cache[key + " "] = value);
      }
      return cache;
    }
    function markFunction(fn) {
      fn[expando] = true;
      return fn;
    }
    function assert(fn) {
      var div = document.createElement("div");
      try {
        return !!fn(div);
      } catch (e) {
        return false;
      } finally {
        if (div.parentNode) {
          div.parentNode.removeChild(div);
        }
        div = null;
      }
    }
    function addHandle(attrs, handler) {
      var arr = attrs.split("|"),
          i = attrs.length;
      while (i--) {
        Expr.attrHandle[arr[i]] = handler;
      }
    }
    function siblingCheck(a, b) {
      var cur = b && a,
          diff = cur && a.nodeType === 1 && b.nodeType === 1 && (~b.sourceIndex || MAX_NEGATIVE) - (~a.sourceIndex || MAX_NEGATIVE);
      if (diff) {
        return diff;
      }
      if (cur) {
        while ((cur = cur.nextSibling)) {
          if (cur === b) {
            return -1;
          }
        }
      }
      return a ? 1 : -1;
    }
    function createInputPseudo(type) {
      return function(elem) {
        var name = elem.nodeName.toLowerCase();
        return name === "input" && elem.type === type;
      };
    }
    function createButtonPseudo(type) {
      return function(elem) {
        var name = elem.nodeName.toLowerCase();
        return (name === "input" || name === "button") && elem.type === type;
      };
    }
    function createPositionalPseudo(fn) {
      return markFunction(function(argument) {
        argument = +argument;
        return markFunction(function(seed, matches) {
          var j,
              matchIndexes = fn([], seed.length, argument),
              i = matchIndexes.length;
          while (i--) {
            if (seed[(j = matchIndexes[i])]) {
              seed[j] = !(matches[j] = seed[j]);
            }
          }
        });
      });
    }
    function testContext(context) {
      return context && typeof context.getElementsByTagName !== "undefined" && context;
    }
    support = Sizzle.support = {};
    isXML = Sizzle.isXML = function(elem) {
      var documentElement = elem && (elem.ownerDocument || elem).documentElement;
      return documentElement ? documentElement.nodeName !== "HTML" : false;
    };
    setDocument = Sizzle.setDocument = function(node) {
      var hasCompare,
          parent,
          doc = node ? node.ownerDocument || node : preferredDoc;
      if (doc === document || doc.nodeType !== 9 || !doc.documentElement) {
        return document;
      }
      document = doc;
      docElem = doc.documentElement;
      parent = doc.defaultView;
      if (parent && parent !== parent.top) {
        if (parent.addEventListener) {
          parent.addEventListener("unload", unloadHandler, false);
        } else if (parent.attachEvent) {
          parent.attachEvent("onunload", unloadHandler);
        }
      }
      documentIsHTML = !isXML(doc);
      support.attributes = assert(function(div) {
        div.className = "i";
        return !div.getAttribute("className");
      });
      support.getElementsByTagName = assert(function(div) {
        div.appendChild(doc.createComment(""));
        return !div.getElementsByTagName("*").length;
      });
      support.getElementsByClassName = rnative.test(doc.getElementsByClassName);
      support.getById = assert(function(div) {
        docElem.appendChild(div).id = expando;
        return !doc.getElementsByName || !doc.getElementsByName(expando).length;
      });
      if (support.getById) {
        Expr.find["ID"] = function(id, context) {
          if (typeof context.getElementById !== "undefined" && documentIsHTML) {
            var m = context.getElementById(id);
            return m && m.parentNode ? [m] : [];
          }
        };
        Expr.filter["ID"] = function(id) {
          var attrId = id.replace(runescape, funescape);
          return function(elem) {
            return elem.getAttribute("id") === attrId;
          };
        };
      } else {
        delete Expr.find["ID"];
        Expr.filter["ID"] = function(id) {
          var attrId = id.replace(runescape, funescape);
          return function(elem) {
            var node = typeof elem.getAttributeNode !== "undefined" && elem.getAttributeNode("id");
            return node && node.value === attrId;
          };
        };
      }
      Expr.find["TAG"] = support.getElementsByTagName ? function(tag, context) {
        if (typeof context.getElementsByTagName !== "undefined") {
          return context.getElementsByTagName(tag);
        } else if (support.qsa) {
          return context.querySelectorAll(tag);
        }
      } : function(tag, context) {
        var elem,
            tmp = [],
            i = 0,
            results = context.getElementsByTagName(tag);
        if (tag === "*") {
          while ((elem = results[i++])) {
            if (elem.nodeType === 1) {
              tmp.push(elem);
            }
          }
          return tmp;
        }
        return results;
      };
      Expr.find["CLASS"] = support.getElementsByClassName && function(className, context) {
        if (documentIsHTML) {
          return context.getElementsByClassName(className);
        }
      };
      rbuggyMatches = [];
      rbuggyQSA = [];
      if ((support.qsa = rnative.test(doc.querySelectorAll))) {
        assert(function(div) {
          docElem.appendChild(div).innerHTML = "<a id='" + expando + "'></a>" + "<select id='" + expando + "-\f]' msallowcapture=''>" + "<option selected=''></option></select>";
          if (div.querySelectorAll("[msallowcapture^='']").length) {
            rbuggyQSA.push("[*^$]=" + whitespace + "*(?:''|\"\")");
          }
          if (!div.querySelectorAll("[selected]").length) {
            rbuggyQSA.push("\\[" + whitespace + "*(?:value|" + booleans + ")");
          }
          if (!div.querySelectorAll("[id~=" + expando + "-]").length) {
            rbuggyQSA.push("~=");
          }
          if (!div.querySelectorAll(":checked").length) {
            rbuggyQSA.push(":checked");
          }
          if (!div.querySelectorAll("a#" + expando + "+*").length) {
            rbuggyQSA.push(".#.+[+~]");
          }
        });
        assert(function(div) {
          var input = doc.createElement("input");
          input.setAttribute("type", "hidden");
          div.appendChild(input).setAttribute("name", "D");
          if (div.querySelectorAll("[name=d]").length) {
            rbuggyQSA.push("name" + whitespace + "*[*^$|!~]?=");
          }
          if (!div.querySelectorAll(":enabled").length) {
            rbuggyQSA.push(":enabled", ":disabled");
          }
          div.querySelectorAll("*,:x");
          rbuggyQSA.push(",.*:");
        });
      }
      if ((support.matchesSelector = rnative.test((matches = docElem.matches || docElem.webkitMatchesSelector || docElem.mozMatchesSelector || docElem.oMatchesSelector || docElem.msMatchesSelector)))) {
        assert(function(div) {
          support.disconnectedMatch = matches.call(div, "div");
          matches.call(div, "[s!='']:x");
          rbuggyMatches.push("!=", pseudos);
        });
      }
      rbuggyQSA = rbuggyQSA.length && new RegExp(rbuggyQSA.join("|"));
      rbuggyMatches = rbuggyMatches.length && new RegExp(rbuggyMatches.join("|"));
      hasCompare = rnative.test(docElem.compareDocumentPosition);
      contains = hasCompare || rnative.test(docElem.contains) ? function(a, b) {
        var adown = a.nodeType === 9 ? a.documentElement : a,
            bup = b && b.parentNode;
        return a === bup || !!(bup && bup.nodeType === 1 && (adown.contains ? adown.contains(bup) : a.compareDocumentPosition && a.compareDocumentPosition(bup) & 16));
      } : function(a, b) {
        if (b) {
          while ((b = b.parentNode)) {
            if (b === a) {
              return true;
            }
          }
        }
        return false;
      };
      sortOrder = hasCompare ? function(a, b) {
        if (a === b) {
          hasDuplicate = true;
          return 0;
        }
        var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
        if (compare) {
          return compare;
        }
        compare = (a.ownerDocument || a) === (b.ownerDocument || b) ? a.compareDocumentPosition(b) : 1;
        if (compare & 1 || (!support.sortDetached && b.compareDocumentPosition(a) === compare)) {
          if (a === doc || a.ownerDocument === preferredDoc && contains(preferredDoc, a)) {
            return -1;
          }
          if (b === doc || b.ownerDocument === preferredDoc && contains(preferredDoc, b)) {
            return 1;
          }
          return sortInput ? (indexOf(sortInput, a) - indexOf(sortInput, b)) : 0;
        }
        return compare & 4 ? -1 : 1;
      } : function(a, b) {
        if (a === b) {
          hasDuplicate = true;
          return 0;
        }
        var cur,
            i = 0,
            aup = a.parentNode,
            bup = b.parentNode,
            ap = [a],
            bp = [b];
        if (!aup || !bup) {
          return a === doc ? -1 : b === doc ? 1 : aup ? -1 : bup ? 1 : sortInput ? (indexOf(sortInput, a) - indexOf(sortInput, b)) : 0;
        } else if (aup === bup) {
          return siblingCheck(a, b);
        }
        cur = a;
        while ((cur = cur.parentNode)) {
          ap.unshift(cur);
        }
        cur = b;
        while ((cur = cur.parentNode)) {
          bp.unshift(cur);
        }
        while (ap[i] === bp[i]) {
          i++;
        }
        return i ? siblingCheck(ap[i], bp[i]) : ap[i] === preferredDoc ? -1 : bp[i] === preferredDoc ? 1 : 0;
      };
      return doc;
    };
    Sizzle.matches = function(expr, elements) {
      return Sizzle(expr, null, null, elements);
    };
    Sizzle.matchesSelector = function(elem, expr) {
      if ((elem.ownerDocument || elem) !== document) {
        setDocument(elem);
      }
      expr = expr.replace(rattributeQuotes, "='$1']");
      if (support.matchesSelector && documentIsHTML && (!rbuggyMatches || !rbuggyMatches.test(expr)) && (!rbuggyQSA || !rbuggyQSA.test(expr))) {
        try {
          var ret = matches.call(elem, expr);
          if (ret || support.disconnectedMatch || elem.document && elem.document.nodeType !== 11) {
            return ret;
          }
        } catch (e) {}
      }
      return Sizzle(expr, document, null, [elem]).length > 0;
    };
    Sizzle.contains = function(context, elem) {
      if ((context.ownerDocument || context) !== document) {
        setDocument(context);
      }
      return contains(context, elem);
    };
    Sizzle.attr = function(elem, name) {
      if ((elem.ownerDocument || elem) !== document) {
        setDocument(elem);
      }
      var fn = Expr.attrHandle[name.toLowerCase()],
          val = fn && hasOwn.call(Expr.attrHandle, name.toLowerCase()) ? fn(elem, name, !documentIsHTML) : undefined;
      return val !== undefined ? val : support.attributes || !documentIsHTML ? elem.getAttribute(name) : (val = elem.getAttributeNode(name)) && val.specified ? val.value : null;
    };
    Sizzle.error = function(msg) {
      throw new Error("Syntax error, unrecognized expression: " + msg);
    };
    Sizzle.uniqueSort = function(results) {
      var elem,
          duplicates = [],
          j = 0,
          i = 0;
      hasDuplicate = !support.detectDuplicates;
      sortInput = !support.sortStable && results.slice(0);
      results.sort(sortOrder);
      if (hasDuplicate) {
        while ((elem = results[i++])) {
          if (elem === results[i]) {
            j = duplicates.push(i);
          }
        }
        while (j--) {
          results.splice(duplicates[j], 1);
        }
      }
      sortInput = null;
      return results;
    };
    getText = Sizzle.getText = function(elem) {
      var node,
          ret = "",
          i = 0,
          nodeType = elem.nodeType;
      if (!nodeType) {
        while ((node = elem[i++])) {
          ret += getText(node);
        }
      } else if (nodeType === 1 || nodeType === 9 || nodeType === 11) {
        if (typeof elem.textContent === "string") {
          return elem.textContent;
        } else {
          for (elem = elem.firstChild; elem; elem = elem.nextSibling) {
            ret += getText(elem);
          }
        }
      } else if (nodeType === 3 || nodeType === 4) {
        return elem.nodeValue;
      }
      return ret;
    };
    Expr = Sizzle.selectors = {
      cacheLength: 50,
      createPseudo: markFunction,
      match: matchExpr,
      attrHandle: {},
      find: {},
      relative: {
        ">": {
          dir: "parentNode",
          first: true
        },
        " ": {dir: "parentNode"},
        "+": {
          dir: "previousSibling",
          first: true
        },
        "~": {dir: "previousSibling"}
      },
      preFilter: {
        "ATTR": function(match) {
          match[1] = match[1].replace(runescape, funescape);
          match[3] = (match[3] || match[4] || match[5] || "").replace(runescape, funescape);
          if (match[2] === "~=") {
            match[3] = " " + match[3] + " ";
          }
          return match.slice(0, 4);
        },
        "CHILD": function(match) {
          match[1] = match[1].toLowerCase();
          if (match[1].slice(0, 3) === "nth") {
            if (!match[3]) {
              Sizzle.error(match[0]);
            }
            match[4] = +(match[4] ? match[5] + (match[6] || 1) : 2 * (match[3] === "even" || match[3] === "odd"));
            match[5] = +((match[7] + match[8]) || match[3] === "odd");
          } else if (match[3]) {
            Sizzle.error(match[0]);
          }
          return match;
        },
        "PSEUDO": function(match) {
          var excess,
              unquoted = !match[6] && match[2];
          if (matchExpr["CHILD"].test(match[0])) {
            return null;
          }
          if (match[3]) {
            match[2] = match[4] || match[5] || "";
          } else if (unquoted && rpseudo.test(unquoted) && (excess = tokenize(unquoted, true)) && (excess = unquoted.indexOf(")", unquoted.length - excess) - unquoted.length)) {
            match[0] = match[0].slice(0, excess);
            match[2] = unquoted.slice(0, excess);
          }
          return match.slice(0, 3);
        }
      },
      filter: {
        "TAG": function(nodeNameSelector) {
          var nodeName = nodeNameSelector.replace(runescape, funescape).toLowerCase();
          return nodeNameSelector === "*" ? function() {
            return true;
          } : function(elem) {
            return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
          };
        },
        "CLASS": function(className) {
          var pattern = classCache[className + " "];
          return pattern || (pattern = new RegExp("(^|" + whitespace + ")" + className + "(" + whitespace + "|$)")) && classCache(className, function(elem) {
            return pattern.test(typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== "undefined" && elem.getAttribute("class") || "");
          });
        },
        "ATTR": function(name, operator, check) {
          return function(elem) {
            var result = Sizzle.attr(elem, name);
            if (result == null) {
              return operator === "!=";
            }
            if (!operator) {
              return true;
            }
            result += "";
            return operator === "=" ? result === check : operator === "!=" ? result !== check : operator === "^=" ? check && result.indexOf(check) === 0 : operator === "*=" ? check && result.indexOf(check) > -1 : operator === "$=" ? check && result.slice(-check.length) === check : operator === "~=" ? (" " + result.replace(rwhitespace, " ") + " ").indexOf(check) > -1 : operator === "|=" ? result === check || result.slice(0, check.length + 1) === check + "-" : false;
          };
        },
        "CHILD": function(type, what, argument, first, last) {
          var simple = type.slice(0, 3) !== "nth",
              forward = type.slice(-4) !== "last",
              ofType = what === "of-type";
          return first === 1 && last === 0 ? function(elem) {
            return !!elem.parentNode;
          } : function(elem, context, xml) {
            var cache,
                outerCache,
                node,
                diff,
                nodeIndex,
                start,
                dir = simple !== forward ? "nextSibling" : "previousSibling",
                parent = elem.parentNode,
                name = ofType && elem.nodeName.toLowerCase(),
                useCache = !xml && !ofType;
            if (parent) {
              if (simple) {
                while (dir) {
                  node = elem;
                  while ((node = node[dir])) {
                    if (ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1) {
                      return false;
                    }
                  }
                  start = dir = type === "only" && !start && "nextSibling";
                }
                return true;
              }
              start = [forward ? parent.firstChild : parent.lastChild];
              if (forward && useCache) {
                outerCache = parent[expando] || (parent[expando] = {});
                cache = outerCache[type] || [];
                nodeIndex = cache[0] === dirruns && cache[1];
                diff = cache[0] === dirruns && cache[2];
                node = nodeIndex && parent.childNodes[nodeIndex];
                while ((node = ++nodeIndex && node && node[dir] || (diff = nodeIndex = 0) || start.pop())) {
                  if (node.nodeType === 1 && ++diff && node === elem) {
                    outerCache[type] = [dirruns, nodeIndex, diff];
                    break;
                  }
                }
              } else if (useCache && (cache = (elem[expando] || (elem[expando] = {}))[type]) && cache[0] === dirruns) {
                diff = cache[1];
              } else {
                while ((node = ++nodeIndex && node && node[dir] || (diff = nodeIndex = 0) || start.pop())) {
                  if ((ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1) && ++diff) {
                    if (useCache) {
                      (node[expando] || (node[expando] = {}))[type] = [dirruns, diff];
                    }
                    if (node === elem) {
                      break;
                    }
                  }
                }
              }
              diff -= last;
              return diff === first || (diff % first === 0 && diff / first >= 0);
            }
          };
        },
        "PSEUDO": function(pseudo, argument) {
          var args,
              fn = Expr.pseudos[pseudo] || Expr.setFilters[pseudo.toLowerCase()] || Sizzle.error("unsupported pseudo: " + pseudo);
          if (fn[expando]) {
            return fn(argument);
          }
          if (fn.length > 1) {
            args = [pseudo, pseudo, "", argument];
            return Expr.setFilters.hasOwnProperty(pseudo.toLowerCase()) ? markFunction(function(seed, matches) {
              var idx,
                  matched = fn(seed, argument),
                  i = matched.length;
              while (i--) {
                idx = indexOf(seed, matched[i]);
                seed[idx] = !(matches[idx] = matched[i]);
              }
            }) : function(elem) {
              return fn(elem, 0, args);
            };
          }
          return fn;
        }
      },
      pseudos: {
        "not": markFunction(function(selector) {
          var input = [],
              results = [],
              matcher = compile(selector.replace(rtrim, "$1"));
          return matcher[expando] ? markFunction(function(seed, matches, context, xml) {
            var elem,
                unmatched = matcher(seed, null, xml, []),
                i = seed.length;
            while (i--) {
              if ((elem = unmatched[i])) {
                seed[i] = !(matches[i] = elem);
              }
            }
          }) : function(elem, context, xml) {
            input[0] = elem;
            matcher(input, null, xml, results);
            input[0] = null;
            return !results.pop();
          };
        }),
        "has": markFunction(function(selector) {
          return function(elem) {
            return Sizzle(selector, elem).length > 0;
          };
        }),
        "contains": markFunction(function(text) {
          text = text.replace(runescape, funescape);
          return function(elem) {
            return (elem.textContent || elem.innerText || getText(elem)).indexOf(text) > -1;
          };
        }),
        "lang": markFunction(function(lang) {
          if (!ridentifier.test(lang || "")) {
            Sizzle.error("unsupported lang: " + lang);
          }
          lang = lang.replace(runescape, funescape).toLowerCase();
          return function(elem) {
            var elemLang;
            do {
              if ((elemLang = documentIsHTML ? elem.lang : elem.getAttribute("xml:lang") || elem.getAttribute("lang"))) {
                elemLang = elemLang.toLowerCase();
                return elemLang === lang || elemLang.indexOf(lang + "-") === 0;
              }
            } while ((elem = elem.parentNode) && elem.nodeType === 1);
            return false;
          };
        }),
        "target": function(elem) {
          var hash = window.location && window.location.hash;
          return hash && hash.slice(1) === elem.id;
        },
        "root": function(elem) {
          return elem === docElem;
        },
        "focus": function(elem) {
          return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
        },
        "enabled": function(elem) {
          return elem.disabled === false;
        },
        "disabled": function(elem) {
          return elem.disabled === true;
        },
        "checked": function(elem) {
          var nodeName = elem.nodeName.toLowerCase();
          return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
        },
        "selected": function(elem) {
          if (elem.parentNode) {
            elem.parentNode.selectedIndex;
          }
          return elem.selected === true;
        },
        "empty": function(elem) {
          for (elem = elem.firstChild; elem; elem = elem.nextSibling) {
            if (elem.nodeType < 6) {
              return false;
            }
          }
          return true;
        },
        "parent": function(elem) {
          return !Expr.pseudos["empty"](elem);
        },
        "header": function(elem) {
          return rheader.test(elem.nodeName);
        },
        "input": function(elem) {
          return rinputs.test(elem.nodeName);
        },
        "button": function(elem) {
          var name = elem.nodeName.toLowerCase();
          return name === "input" && elem.type === "button" || name === "button";
        },
        "text": function(elem) {
          var attr;
          return elem.nodeName.toLowerCase() === "input" && elem.type === "text" && ((attr = elem.getAttribute("type")) == null || attr.toLowerCase() === "text");
        },
        "first": createPositionalPseudo(function() {
          return [0];
        }),
        "last": createPositionalPseudo(function(matchIndexes, length) {
          return [length - 1];
        }),
        "eq": createPositionalPseudo(function(matchIndexes, length, argument) {
          return [argument < 0 ? argument + length : argument];
        }),
        "even": createPositionalPseudo(function(matchIndexes, length) {
          var i = 0;
          for (; i < length; i += 2) {
            matchIndexes.push(i);
          }
          return matchIndexes;
        }),
        "odd": createPositionalPseudo(function(matchIndexes, length) {
          var i = 1;
          for (; i < length; i += 2) {
            matchIndexes.push(i);
          }
          return matchIndexes;
        }),
        "lt": createPositionalPseudo(function(matchIndexes, length, argument) {
          var i = argument < 0 ? argument + length : argument;
          for (; --i >= 0; ) {
            matchIndexes.push(i);
          }
          return matchIndexes;
        }),
        "gt": createPositionalPseudo(function(matchIndexes, length, argument) {
          var i = argument < 0 ? argument + length : argument;
          for (; ++i < length; ) {
            matchIndexes.push(i);
          }
          return matchIndexes;
        })
      }
    };
    Expr.pseudos["nth"] = Expr.pseudos["eq"];
    for (i in {
      radio: true,
      checkbox: true,
      file: true,
      password: true,
      image: true
    }) {
      Expr.pseudos[i] = createInputPseudo(i);
    }
    for (i in {
      submit: true,
      reset: true
    }) {
      Expr.pseudos[i] = createButtonPseudo(i);
    }
    function setFilters() {}
    setFilters.prototype = Expr.filters = Expr.pseudos;
    Expr.setFilters = new setFilters();
    tokenize = Sizzle.tokenize = function(selector, parseOnly) {
      var matched,
          match,
          tokens,
          type,
          soFar,
          groups,
          preFilters,
          cached = tokenCache[selector + " "];
      if (cached) {
        return parseOnly ? 0 : cached.slice(0);
      }
      soFar = selector;
      groups = [];
      preFilters = Expr.preFilter;
      while (soFar) {
        if (!matched || (match = rcomma.exec(soFar))) {
          if (match) {
            soFar = soFar.slice(match[0].length) || soFar;
          }
          groups.push((tokens = []));
        }
        matched = false;
        if ((match = rcombinators.exec(soFar))) {
          matched = match.shift();
          tokens.push({
            value: matched,
            type: match[0].replace(rtrim, " ")
          });
          soFar = soFar.slice(matched.length);
        }
        for (type in Expr.filter) {
          if ((match = matchExpr[type].exec(soFar)) && (!preFilters[type] || (match = preFilters[type](match)))) {
            matched = match.shift();
            tokens.push({
              value: matched,
              type: type,
              matches: match
            });
            soFar = soFar.slice(matched.length);
          }
        }
        if (!matched) {
          break;
        }
      }
      return parseOnly ? soFar.length : soFar ? Sizzle.error(selector) : tokenCache(selector, groups).slice(0);
    };
    function toSelector(tokens) {
      var i = 0,
          len = tokens.length,
          selector = "";
      for (; i < len; i++) {
        selector += tokens[i].value;
      }
      return selector;
    }
    function addCombinator(matcher, combinator, base) {
      var dir = combinator.dir,
          checkNonElements = base && dir === "parentNode",
          doneName = done++;
      return combinator.first ? function(elem, context, xml) {
        while ((elem = elem[dir])) {
          if (elem.nodeType === 1 || checkNonElements) {
            return matcher(elem, context, xml);
          }
        }
      } : function(elem, context, xml) {
        var oldCache,
            outerCache,
            newCache = [dirruns, doneName];
        if (xml) {
          while ((elem = elem[dir])) {
            if (elem.nodeType === 1 || checkNonElements) {
              if (matcher(elem, context, xml)) {
                return true;
              }
            }
          }
        } else {
          while ((elem = elem[dir])) {
            if (elem.nodeType === 1 || checkNonElements) {
              outerCache = elem[expando] || (elem[expando] = {});
              if ((oldCache = outerCache[dir]) && oldCache[0] === dirruns && oldCache[1] === doneName) {
                return (newCache[2] = oldCache[2]);
              } else {
                outerCache[dir] = newCache;
                if ((newCache[2] = matcher(elem, context, xml))) {
                  return true;
                }
              }
            }
          }
        }
      };
    }
    function elementMatcher(matchers) {
      return matchers.length > 1 ? function(elem, context, xml) {
        var i = matchers.length;
        while (i--) {
          if (!matchers[i](elem, context, xml)) {
            return false;
          }
        }
        return true;
      } : matchers[0];
    }
    function multipleContexts(selector, contexts, results) {
      var i = 0,
          len = contexts.length;
      for (; i < len; i++) {
        Sizzle(selector, contexts[i], results);
      }
      return results;
    }
    function condense(unmatched, map, filter, context, xml) {
      var elem,
          newUnmatched = [],
          i = 0,
          len = unmatched.length,
          mapped = map != null;
      for (; i < len; i++) {
        if ((elem = unmatched[i])) {
          if (!filter || filter(elem, context, xml)) {
            newUnmatched.push(elem);
            if (mapped) {
              map.push(i);
            }
          }
        }
      }
      return newUnmatched;
    }
    function setMatcher(preFilter, selector, matcher, postFilter, postFinder, postSelector) {
      if (postFilter && !postFilter[expando]) {
        postFilter = setMatcher(postFilter);
      }
      if (postFinder && !postFinder[expando]) {
        postFinder = setMatcher(postFinder, postSelector);
      }
      return markFunction(function(seed, results, context, xml) {
        var temp,
            i,
            elem,
            preMap = [],
            postMap = [],
            preexisting = results.length,
            elems = seed || multipleContexts(selector || "*", context.nodeType ? [context] : context, []),
            matcherIn = preFilter && (seed || !selector) ? condense(elems, preMap, preFilter, context, xml) : elems,
            matcherOut = matcher ? postFinder || (seed ? preFilter : preexisting || postFilter) ? [] : results : matcherIn;
        if (matcher) {
          matcher(matcherIn, matcherOut, context, xml);
        }
        if (postFilter) {
          temp = condense(matcherOut, postMap);
          postFilter(temp, [], context, xml);
          i = temp.length;
          while (i--) {
            if ((elem = temp[i])) {
              matcherOut[postMap[i]] = !(matcherIn[postMap[i]] = elem);
            }
          }
        }
        if (seed) {
          if (postFinder || preFilter) {
            if (postFinder) {
              temp = [];
              i = matcherOut.length;
              while (i--) {
                if ((elem = matcherOut[i])) {
                  temp.push((matcherIn[i] = elem));
                }
              }
              postFinder(null, (matcherOut = []), temp, xml);
            }
            i = matcherOut.length;
            while (i--) {
              if ((elem = matcherOut[i]) && (temp = postFinder ? indexOf(seed, elem) : preMap[i]) > -1) {
                seed[temp] = !(results[temp] = elem);
              }
            }
          }
        } else {
          matcherOut = condense(matcherOut === results ? matcherOut.splice(preexisting, matcherOut.length) : matcherOut);
          if (postFinder) {
            postFinder(null, results, matcherOut, xml);
          } else {
            push.apply(results, matcherOut);
          }
        }
      });
    }
    function matcherFromTokens(tokens) {
      var checkContext,
          matcher,
          j,
          len = tokens.length,
          leadingRelative = Expr.relative[tokens[0].type],
          implicitRelative = leadingRelative || Expr.relative[" "],
          i = leadingRelative ? 1 : 0,
          matchContext = addCombinator(function(elem) {
            return elem === checkContext;
          }, implicitRelative, true),
          matchAnyContext = addCombinator(function(elem) {
            return indexOf(checkContext, elem) > -1;
          }, implicitRelative, true),
          matchers = [function(elem, context, xml) {
            var ret = (!leadingRelative && (xml || context !== outermostContext)) || ((checkContext = context).nodeType ? matchContext(elem, context, xml) : matchAnyContext(elem, context, xml));
            checkContext = null;
            return ret;
          }];
      for (; i < len; i++) {
        if ((matcher = Expr.relative[tokens[i].type])) {
          matchers = [addCombinator(elementMatcher(matchers), matcher)];
        } else {
          matcher = Expr.filter[tokens[i].type].apply(null, tokens[i].matches);
          if (matcher[expando]) {
            j = ++i;
            for (; j < len; j++) {
              if (Expr.relative[tokens[j].type]) {
                break;
              }
            }
            return setMatcher(i > 1 && elementMatcher(matchers), i > 1 && toSelector(tokens.slice(0, i - 1).concat({value: tokens[i - 2].type === " " ? "*" : ""})).replace(rtrim, "$1"), matcher, i < j && matcherFromTokens(tokens.slice(i, j)), j < len && matcherFromTokens((tokens = tokens.slice(j))), j < len && toSelector(tokens));
          }
          matchers.push(matcher);
        }
      }
      return elementMatcher(matchers);
    }
    function matcherFromGroupMatchers(elementMatchers, setMatchers) {
      var bySet = setMatchers.length > 0,
          byElement = elementMatchers.length > 0,
          superMatcher = function(seed, context, xml, results, outermost) {
            var elem,
                j,
                matcher,
                matchedCount = 0,
                i = "0",
                unmatched = seed && [],
                setMatched = [],
                contextBackup = outermostContext,
                elems = seed || byElement && Expr.find["TAG"]("*", outermost),
                dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1),
                len = elems.length;
            if (outermost) {
              outermostContext = context !== document && context;
            }
            for (; i !== len && (elem = elems[i]) != null; i++) {
              if (byElement && elem) {
                j = 0;
                while ((matcher = elementMatchers[j++])) {
                  if (matcher(elem, context, xml)) {
                    results.push(elem);
                    break;
                  }
                }
                if (outermost) {
                  dirruns = dirrunsUnique;
                }
              }
              if (bySet) {
                if ((elem = !matcher && elem)) {
                  matchedCount--;
                }
                if (seed) {
                  unmatched.push(elem);
                }
              }
            }
            matchedCount += i;
            if (bySet && i !== matchedCount) {
              j = 0;
              while ((matcher = setMatchers[j++])) {
                matcher(unmatched, setMatched, context, xml);
              }
              if (seed) {
                if (matchedCount > 0) {
                  while (i--) {
                    if (!(unmatched[i] || setMatched[i])) {
                      setMatched[i] = pop.call(results);
                    }
                  }
                }
                setMatched = condense(setMatched);
              }
              push.apply(results, setMatched);
              if (outermost && !seed && setMatched.length > 0 && (matchedCount + setMatchers.length) > 1) {
                Sizzle.uniqueSort(results);
              }
            }
            if (outermost) {
              dirruns = dirrunsUnique;
              outermostContext = contextBackup;
            }
            return unmatched;
          };
      return bySet ? markFunction(superMatcher) : superMatcher;
    }
    compile = Sizzle.compile = function(selector, match) {
      var i,
          setMatchers = [],
          elementMatchers = [],
          cached = compilerCache[selector + " "];
      if (!cached) {
        if (!match) {
          match = tokenize(selector);
        }
        i = match.length;
        while (i--) {
          cached = matcherFromTokens(match[i]);
          if (cached[expando]) {
            setMatchers.push(cached);
          } else {
            elementMatchers.push(cached);
          }
        }
        cached = compilerCache(selector, matcherFromGroupMatchers(elementMatchers, setMatchers));
        cached.selector = selector;
      }
      return cached;
    };
    select = Sizzle.select = function(selector, context, results, seed) {
      var i,
          tokens,
          token,
          type,
          find,
          compiled = typeof selector === "function" && selector,
          match = !seed && tokenize((selector = compiled.selector || selector));
      results = results || [];
      if (match.length === 1) {
        tokens = match[0] = match[0].slice(0);
        if (tokens.length > 2 && (token = tokens[0]).type === "ID" && support.getById && context.nodeType === 9 && documentIsHTML && Expr.relative[tokens[1].type]) {
          context = (Expr.find["ID"](token.matches[0].replace(runescape, funescape), context) || [])[0];
          if (!context) {
            return results;
          } else if (compiled) {
            context = context.parentNode;
          }
          selector = selector.slice(tokens.shift().value.length);
        }
        i = matchExpr["needsContext"].test(selector) ? 0 : tokens.length;
        while (i--) {
          token = tokens[i];
          if (Expr.relative[(type = token.type)]) {
            break;
          }
          if ((find = Expr.find[type])) {
            if ((seed = find(token.matches[0].replace(runescape, funescape), rsibling.test(tokens[0].type) && testContext(context.parentNode) || context))) {
              tokens.splice(i, 1);
              selector = seed.length && toSelector(tokens);
              if (!selector) {
                push.apply(results, seed);
                return results;
              }
              break;
            }
          }
        }
      }
      (compiled || compile(selector, match))(seed, context, !documentIsHTML, results, rsibling.test(selector) && testContext(context.parentNode) || context);
      return results;
    };
    support.sortStable = expando.split("").sort(sortOrder).join("") === expando;
    support.detectDuplicates = !!hasDuplicate;
    setDocument();
    support.sortDetached = assert(function(div1) {
      return div1.compareDocumentPosition(document.createElement("div")) & 1;
    });
    if (!assert(function(div) {
      div.innerHTML = "<a href='#'></a>";
      return div.firstChild.getAttribute("href") === "#";
    })) {
      addHandle("type|href|height|width", function(elem, name, isXML) {
        if (!isXML) {
          return elem.getAttribute(name, name.toLowerCase() === "type" ? 1 : 2);
        }
      });
    }
    if (!support.attributes || !assert(function(div) {
      div.innerHTML = "<input/>";
      div.firstChild.setAttribute("value", "");
      return div.firstChild.getAttribute("value") === "";
    })) {
      addHandle("value", function(elem, name, isXML) {
        if (!isXML && elem.nodeName.toLowerCase() === "input") {
          return elem.defaultValue;
        }
      });
    }
    if (!assert(function(div) {
      return div.getAttribute("disabled") == null;
    })) {
      addHandle(booleans, function(elem, name, isXML) {
        var val;
        if (!isXML) {
          return elem[name] === true ? name.toLowerCase() : (val = elem.getAttributeNode(name)) && val.specified ? val.value : null;
        }
      });
    }
    return Sizzle;
  })(window);
  jQuery.find = Sizzle;
  jQuery.expr = Sizzle.selectors;
  jQuery.expr[":"] = jQuery.expr.pseudos;
  jQuery.unique = Sizzle.uniqueSort;
  jQuery.text = Sizzle.getText;
  jQuery.isXMLDoc = Sizzle.isXML;
  jQuery.contains = Sizzle.contains;
  var rneedsContext = jQuery.expr.match.needsContext;
  var rsingleTag = (/^<(\w+)\s*\/?>(?:<\/\1>|)$/);
  var risSimple = /^.[^:#\[\.,]*$/;
  function winnow(elements, qualifier, not) {
    if (jQuery.isFunction(qualifier)) {
      return jQuery.grep(elements, function(elem, i) {
        return !!qualifier.call(elem, i, elem) !== not;
      });
    }
    if (qualifier.nodeType) {
      return jQuery.grep(elements, function(elem) {
        return (elem === qualifier) !== not;
      });
    }
    if (typeof qualifier === "string") {
      if (risSimple.test(qualifier)) {
        return jQuery.filter(qualifier, elements, not);
      }
      qualifier = jQuery.filter(qualifier, elements);
    }
    return jQuery.grep(elements, function(elem) {
      return (indexOf.call(qualifier, elem) >= 0) !== not;
    });
  }
  jQuery.filter = function(expr, elems, not) {
    var elem = elems[0];
    if (not) {
      expr = ":not(" + expr + ")";
    }
    return elems.length === 1 && elem.nodeType === 1 ? jQuery.find.matchesSelector(elem, expr) ? [elem] : [] : jQuery.find.matches(expr, jQuery.grep(elems, function(elem) {
      return elem.nodeType === 1;
    }));
  };
  jQuery.fn.extend({
    find: function(selector) {
      var i,
          len = this.length,
          ret = [],
          self = this;
      if (typeof selector !== "string") {
        return this.pushStack(jQuery(selector).filter(function() {
          for (i = 0; i < len; i++) {
            if (jQuery.contains(self[i], this)) {
              return true;
            }
          }
        }));
      }
      for (i = 0; i < len; i++) {
        jQuery.find(selector, self[i], ret);
      }
      ret = this.pushStack(len > 1 ? jQuery.unique(ret) : ret);
      ret.selector = this.selector ? this.selector + " " + selector : selector;
      return ret;
    },
    filter: function(selector) {
      return this.pushStack(winnow(this, selector || [], false));
    },
    not: function(selector) {
      return this.pushStack(winnow(this, selector || [], true));
    },
    is: function(selector) {
      return !!winnow(this, typeof selector === "string" && rneedsContext.test(selector) ? jQuery(selector) : selector || [], false).length;
    }
  });
  var rootjQuery,
      rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,
      init = jQuery.fn.init = function(selector, context) {
        var match,
            elem;
        if (!selector) {
          return this;
        }
        if (typeof selector === "string") {
          if (selector[0] === "<" && selector[selector.length - 1] === ">" && selector.length >= 3) {
            match = [null, selector, null];
          } else {
            match = rquickExpr.exec(selector);
          }
          if (match && (match[1] || !context)) {
            if (match[1]) {
              context = context instanceof jQuery ? context[0] : context;
              jQuery.merge(this, jQuery.parseHTML(match[1], context && context.nodeType ? context.ownerDocument || context : document, true));
              if (rsingleTag.test(match[1]) && jQuery.isPlainObject(context)) {
                for (match in context) {
                  if (jQuery.isFunction(this[match])) {
                    this[match](context[match]);
                  } else {
                    this.attr(match, context[match]);
                  }
                }
              }
              return this;
            } else {
              elem = document.getElementById(match[2]);
              if (elem && elem.parentNode) {
                this.length = 1;
                this[0] = elem;
              }
              this.context = document;
              this.selector = selector;
              return this;
            }
          } else if (!context || context.jquery) {
            return (context || rootjQuery).find(selector);
          } else {
            return this.constructor(context).find(selector);
          }
        } else if (selector.nodeType) {
          this.context = this[0] = selector;
          this.length = 1;
          return this;
        } else if (jQuery.isFunction(selector)) {
          return typeof rootjQuery.ready !== "undefined" ? rootjQuery.ready(selector) : selector(jQuery);
        }
        if (selector.selector !== undefined) {
          this.selector = selector.selector;
          this.context = selector.context;
        }
        return jQuery.makeArray(selector, this);
      };
  init.prototype = jQuery.fn;
  rootjQuery = jQuery(document);
  var rparentsprev = /^(?:parents|prev(?:Until|All))/,
      guaranteedUnique = {
        children: true,
        contents: true,
        next: true,
        prev: true
      };
  jQuery.extend({
    dir: function(elem, dir, until) {
      var matched = [],
          truncate = until !== undefined;
      while ((elem = elem[dir]) && elem.nodeType !== 9) {
        if (elem.nodeType === 1) {
          if (truncate && jQuery(elem).is(until)) {
            break;
          }
          matched.push(elem);
        }
      }
      return matched;
    },
    sibling: function(n, elem) {
      var matched = [];
      for (; n; n = n.nextSibling) {
        if (n.nodeType === 1 && n !== elem) {
          matched.push(n);
        }
      }
      return matched;
    }
  });
  jQuery.fn.extend({
    has: function(target) {
      var targets = jQuery(target, this),
          l = targets.length;
      return this.filter(function() {
        var i = 0;
        for (; i < l; i++) {
          if (jQuery.contains(this, targets[i])) {
            return true;
          }
        }
      });
    },
    closest: function(selectors, context) {
      var cur,
          i = 0,
          l = this.length,
          matched = [],
          pos = rneedsContext.test(selectors) || typeof selectors !== "string" ? jQuery(selectors, context || this.context) : 0;
      for (; i < l; i++) {
        for (cur = this[i]; cur && cur !== context; cur = cur.parentNode) {
          if (cur.nodeType < 11 && (pos ? pos.index(cur) > -1 : cur.nodeType === 1 && jQuery.find.matchesSelector(cur, selectors))) {
            matched.push(cur);
            break;
          }
        }
      }
      return this.pushStack(matched.length > 1 ? jQuery.unique(matched) : matched);
    },
    index: function(elem) {
      if (!elem) {
        return (this[0] && this[0].parentNode) ? this.first().prevAll().length : -1;
      }
      if (typeof elem === "string") {
        return indexOf.call(jQuery(elem), this[0]);
      }
      return indexOf.call(this, elem.jquery ? elem[0] : elem);
    },
    add: function(selector, context) {
      return this.pushStack(jQuery.unique(jQuery.merge(this.get(), jQuery(selector, context))));
    },
    addBack: function(selector) {
      return this.add(selector == null ? this.prevObject : this.prevObject.filter(selector));
    }
  });
  function sibling(cur, dir) {
    while ((cur = cur[dir]) && cur.nodeType !== 1) {}
    return cur;
  }
  jQuery.each({
    parent: function(elem) {
      var parent = elem.parentNode;
      return parent && parent.nodeType !== 11 ? parent : null;
    },
    parents: function(elem) {
      return jQuery.dir(elem, "parentNode");
    },
    parentsUntil: function(elem, i, until) {
      return jQuery.dir(elem, "parentNode", until);
    },
    next: function(elem) {
      return sibling(elem, "nextSibling");
    },
    prev: function(elem) {
      return sibling(elem, "previousSibling");
    },
    nextAll: function(elem) {
      return jQuery.dir(elem, "nextSibling");
    },
    prevAll: function(elem) {
      return jQuery.dir(elem, "previousSibling");
    },
    nextUntil: function(elem, i, until) {
      return jQuery.dir(elem, "nextSibling", until);
    },
    prevUntil: function(elem, i, until) {
      return jQuery.dir(elem, "previousSibling", until);
    },
    siblings: function(elem) {
      return jQuery.sibling((elem.parentNode || {}).firstChild, elem);
    },
    children: function(elem) {
      return jQuery.sibling(elem.firstChild);
    },
    contents: function(elem) {
      return elem.contentDocument || jQuery.merge([], elem.childNodes);
    }
  }, function(name, fn) {
    jQuery.fn[name] = function(until, selector) {
      var matched = jQuery.map(this, fn, until);
      if (name.slice(-5) !== "Until") {
        selector = until;
      }
      if (selector && typeof selector === "string") {
        matched = jQuery.filter(selector, matched);
      }
      if (this.length > 1) {
        if (!guaranteedUnique[name]) {
          jQuery.unique(matched);
        }
        if (rparentsprev.test(name)) {
          matched.reverse();
        }
      }
      return this.pushStack(matched);
    };
  });
  var rnotwhite = (/\S+/g);
  var optionsCache = {};
  function createOptions(options) {
    var object = optionsCache[options] = {};
    jQuery.each(options.match(rnotwhite) || [], function(_, flag) {
      object[flag] = true;
    });
    return object;
  }
  jQuery.Callbacks = function(options) {
    options = typeof options === "string" ? (optionsCache[options] || createOptions(options)) : jQuery.extend({}, options);
    var memory,
        fired,
        firing,
        firingStart,
        firingLength,
        firingIndex,
        list = [],
        stack = !options.once && [],
        fire = function(data) {
          memory = options.memory && data;
          fired = true;
          firingIndex = firingStart || 0;
          firingStart = 0;
          firingLength = list.length;
          firing = true;
          for (; list && firingIndex < firingLength; firingIndex++) {
            if (list[firingIndex].apply(data[0], data[1]) === false && options.stopOnFalse) {
              memory = false;
              break;
            }
          }
          firing = false;
          if (list) {
            if (stack) {
              if (stack.length) {
                fire(stack.shift());
              }
            } else if (memory) {
              list = [];
            } else {
              self.disable();
            }
          }
        },
        self = {
          add: function() {
            if (list) {
              var start = list.length;
              (function add(args) {
                jQuery.each(args, function(_, arg) {
                  var type = jQuery.type(arg);
                  if (type === "function") {
                    if (!options.unique || !self.has(arg)) {
                      list.push(arg);
                    }
                  } else if (arg && arg.length && type !== "string") {
                    add(arg);
                  }
                });
              })(arguments);
              if (firing) {
                firingLength = list.length;
              } else if (memory) {
                firingStart = start;
                fire(memory);
              }
            }
            return this;
          },
          remove: function() {
            if (list) {
              jQuery.each(arguments, function(_, arg) {
                var index;
                while ((index = jQuery.inArray(arg, list, index)) > -1) {
                  list.splice(index, 1);
                  if (firing) {
                    if (index <= firingLength) {
                      firingLength--;
                    }
                    if (index <= firingIndex) {
                      firingIndex--;
                    }
                  }
                }
              });
            }
            return this;
          },
          has: function(fn) {
            return fn ? jQuery.inArray(fn, list) > -1 : !!(list && list.length);
          },
          empty: function() {
            list = [];
            firingLength = 0;
            return this;
          },
          disable: function() {
            list = stack = memory = undefined;
            return this;
          },
          disabled: function() {
            return !list;
          },
          lock: function() {
            stack = undefined;
            if (!memory) {
              self.disable();
            }
            return this;
          },
          locked: function() {
            return !stack;
          },
          fireWith: function(context, args) {
            if (list && (!fired || stack)) {
              args = args || [];
              args = [context, args.slice ? args.slice() : args];
              if (firing) {
                stack.push(args);
              } else {
                fire(args);
              }
            }
            return this;
          },
          fire: function() {
            self.fireWith(this, arguments);
            return this;
          },
          fired: function() {
            return !!fired;
          }
        };
    return self;
  };
  jQuery.extend({
    Deferred: function(func) {
      var tuples = [["resolve", "done", jQuery.Callbacks("once memory"), "resolved"], ["reject", "fail", jQuery.Callbacks("once memory"), "rejected"], ["notify", "progress", jQuery.Callbacks("memory")]],
          state = "pending",
          promise = {
            state: function() {
              return state;
            },
            always: function() {
              deferred.done(arguments).fail(arguments);
              return this;
            },
            then: function() {
              var fns = arguments;
              return jQuery.Deferred(function(newDefer) {
                jQuery.each(tuples, function(i, tuple) {
                  var fn = jQuery.isFunction(fns[i]) && fns[i];
                  deferred[tuple[1]](function() {
                    var returned = fn && fn.apply(this, arguments);
                    if (returned && jQuery.isFunction(returned.promise)) {
                      returned.promise().done(newDefer.resolve).fail(newDefer.reject).progress(newDefer.notify);
                    } else {
                      newDefer[tuple[0] + "With"](this === promise ? newDefer.promise() : this, fn ? [returned] : arguments);
                    }
                  });
                });
                fns = null;
              }).promise();
            },
            promise: function(obj) {
              return obj != null ? jQuery.extend(obj, promise) : promise;
            }
          },
          deferred = {};
      promise.pipe = promise.then;
      jQuery.each(tuples, function(i, tuple) {
        var list = tuple[2],
            stateString = tuple[3];
        promise[tuple[1]] = list.add;
        if (stateString) {
          list.add(function() {
            state = stateString;
          }, tuples[i ^ 1][2].disable, tuples[2][2].lock);
        }
        deferred[tuple[0]] = function() {
          deferred[tuple[0] + "With"](this === deferred ? promise : this, arguments);
          return this;
        };
        deferred[tuple[0] + "With"] = list.fireWith;
      });
      promise.promise(deferred);
      if (func) {
        func.call(deferred, deferred);
      }
      return deferred;
    },
    when: function(subordinate) {
      var i = 0,
          resolveValues = slice.call(arguments),
          length = resolveValues.length,
          remaining = length !== 1 || (subordinate && jQuery.isFunction(subordinate.promise)) ? length : 0,
          deferred = remaining === 1 ? subordinate : jQuery.Deferred(),
          updateFunc = function(i, contexts, values) {
            return function(value) {
              contexts[i] = this;
              values[i] = arguments.length > 1 ? slice.call(arguments) : value;
              if (values === progressValues) {
                deferred.notifyWith(contexts, values);
              } else if (!(--remaining)) {
                deferred.resolveWith(contexts, values);
              }
            };
          },
          progressValues,
          progressContexts,
          resolveContexts;
      if (length > 1) {
        progressValues = new Array(length);
        progressContexts = new Array(length);
        resolveContexts = new Array(length);
        for (; i < length; i++) {
          if (resolveValues[i] && jQuery.isFunction(resolveValues[i].promise)) {
            resolveValues[i].promise().done(updateFunc(i, resolveContexts, resolveValues)).fail(deferred.reject).progress(updateFunc(i, progressContexts, progressValues));
          } else {
            --remaining;
          }
        }
      }
      if (!remaining) {
        deferred.resolveWith(resolveContexts, resolveValues);
      }
      return deferred.promise();
    }
  });
  var readyList;
  jQuery.fn.ready = function(fn) {
    jQuery.ready.promise().done(fn);
    return this;
  };
  jQuery.extend({
    isReady: false,
    readyWait: 1,
    holdReady: function(hold) {
      if (hold) {
        jQuery.readyWait++;
      } else {
        jQuery.ready(true);
      }
    },
    ready: function(wait) {
      if (wait === true ? --jQuery.readyWait : jQuery.isReady) {
        return ;
      }
      jQuery.isReady = true;
      if (wait !== true && --jQuery.readyWait > 0) {
        return ;
      }
      readyList.resolveWith(document, [jQuery]);
      if (jQuery.fn.triggerHandler) {
        jQuery(document).triggerHandler("ready");
        jQuery(document).off("ready");
      }
    }
  });
  function completed() {
    document.removeEventListener("DOMContentLoaded", completed, false);
    window.removeEventListener("load", completed, false);
    jQuery.ready();
  }
  jQuery.ready.promise = function(obj) {
    if (!readyList) {
      readyList = jQuery.Deferred();
      if (document.readyState === "complete") {
        setTimeout(jQuery.ready);
      } else {
        document.addEventListener("DOMContentLoaded", completed, false);
        window.addEventListener("load", completed, false);
      }
    }
    return readyList.promise(obj);
  };
  jQuery.ready.promise();
  var access = jQuery.access = function(elems, fn, key, value, chainable, emptyGet, raw) {
    var i = 0,
        len = elems.length,
        bulk = key == null;
    if (jQuery.type(key) === "object") {
      chainable = true;
      for (i in key) {
        jQuery.access(elems, fn, i, key[i], true, emptyGet, raw);
      }
    } else if (value !== undefined) {
      chainable = true;
      if (!jQuery.isFunction(value)) {
        raw = true;
      }
      if (bulk) {
        if (raw) {
          fn.call(elems, value);
          fn = null;
        } else {
          bulk = fn;
          fn = function(elem, key, value) {
            return bulk.call(jQuery(elem), value);
          };
        }
      }
      if (fn) {
        for (; i < len; i++) {
          fn(elems[i], key, raw ? value : value.call(elems[i], i, fn(elems[i], key)));
        }
      }
    }
    return chainable ? elems : bulk ? fn.call(elems) : len ? fn(elems[0], key) : emptyGet;
  };
  jQuery.acceptData = function(owner) {
    return owner.nodeType === 1 || owner.nodeType === 9 || !(+owner.nodeType);
  };
  function Data() {
    Object.defineProperty(this.cache = {}, 0, {get: function() {
        return {};
      }});
    this.expando = jQuery.expando + Data.uid++;
  }
  Data.uid = 1;
  Data.accepts = jQuery.acceptData;
  Data.prototype = {
    key: function(owner) {
      if (!Data.accepts(owner)) {
        return 0;
      }
      var descriptor = {},
          unlock = owner[this.expando];
      if (!unlock) {
        unlock = Data.uid++;
        try {
          descriptor[this.expando] = {value: unlock};
          Object.defineProperties(owner, descriptor);
        } catch (e) {
          descriptor[this.expando] = unlock;
          jQuery.extend(owner, descriptor);
        }
      }
      if (!this.cache[unlock]) {
        this.cache[unlock] = {};
      }
      return unlock;
    },
    set: function(owner, data, value) {
      var prop,
          unlock = this.key(owner),
          cache = this.cache[unlock];
      if (typeof data === "string") {
        cache[data] = value;
      } else {
        if (jQuery.isEmptyObject(cache)) {
          jQuery.extend(this.cache[unlock], data);
        } else {
          for (prop in data) {
            cache[prop] = data[prop];
          }
        }
      }
      return cache;
    },
    get: function(owner, key) {
      var cache = this.cache[this.key(owner)];
      return key === undefined ? cache : cache[key];
    },
    access: function(owner, key, value) {
      var stored;
      if (key === undefined || ((key && typeof key === "string") && value === undefined)) {
        stored = this.get(owner, key);
        return stored !== undefined ? stored : this.get(owner, jQuery.camelCase(key));
      }
      this.set(owner, key, value);
      return value !== undefined ? value : key;
    },
    remove: function(owner, key) {
      var i,
          name,
          camel,
          unlock = this.key(owner),
          cache = this.cache[unlock];
      if (key === undefined) {
        this.cache[unlock] = {};
      } else {
        if (jQuery.isArray(key)) {
          name = key.concat(key.map(jQuery.camelCase));
        } else {
          camel = jQuery.camelCase(key);
          if (key in cache) {
            name = [key, camel];
          } else {
            name = camel;
            name = name in cache ? [name] : (name.match(rnotwhite) || []);
          }
        }
        i = name.length;
        while (i--) {
          delete cache[name[i]];
        }
      }
    },
    hasData: function(owner) {
      return !jQuery.isEmptyObject(this.cache[owner[this.expando]] || {});
    },
    discard: function(owner) {
      if (owner[this.expando]) {
        delete this.cache[owner[this.expando]];
      }
    }
  };
  var data_priv = new Data();
  var data_user = new Data();
  var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
      rmultiDash = /([A-Z])/g;
  function dataAttr(elem, key, data) {
    var name;
    if (data === undefined && elem.nodeType === 1) {
      name = "data-" + key.replace(rmultiDash, "-$1").toLowerCase();
      data = elem.getAttribute(name);
      if (typeof data === "string") {
        try {
          data = data === "true" ? true : data === "false" ? false : data === "null" ? null : +data + "" === data ? +data : rbrace.test(data) ? jQuery.parseJSON(data) : data;
        } catch (e) {}
        data_user.set(elem, key, data);
      } else {
        data = undefined;
      }
    }
    return data;
  }
  jQuery.extend({
    hasData: function(elem) {
      return data_user.hasData(elem) || data_priv.hasData(elem);
    },
    data: function(elem, name, data) {
      return data_user.access(elem, name, data);
    },
    removeData: function(elem, name) {
      data_user.remove(elem, name);
    },
    _data: function(elem, name, data) {
      return data_priv.access(elem, name, data);
    },
    _removeData: function(elem, name) {
      data_priv.remove(elem, name);
    }
  });
  jQuery.fn.extend({
    data: function(key, value) {
      var i,
          name,
          data,
          elem = this[0],
          attrs = elem && elem.attributes;
      if (key === undefined) {
        if (this.length) {
          data = data_user.get(elem);
          if (elem.nodeType === 1 && !data_priv.get(elem, "hasDataAttrs")) {
            i = attrs.length;
            while (i--) {
              if (attrs[i]) {
                name = attrs[i].name;
                if (name.indexOf("data-") === 0) {
                  name = jQuery.camelCase(name.slice(5));
                  dataAttr(elem, name, data[name]);
                }
              }
            }
            data_priv.set(elem, "hasDataAttrs", true);
          }
        }
        return data;
      }
      if (typeof key === "object") {
        return this.each(function() {
          data_user.set(this, key);
        });
      }
      return access(this, function(value) {
        var data,
            camelKey = jQuery.camelCase(key);
        if (elem && value === undefined) {
          data = data_user.get(elem, key);
          if (data !== undefined) {
            return data;
          }
          data = data_user.get(elem, camelKey);
          if (data !== undefined) {
            return data;
          }
          data = dataAttr(elem, camelKey, undefined);
          if (data !== undefined) {
            return data;
          }
          return ;
        }
        this.each(function() {
          var data = data_user.get(this, camelKey);
          data_user.set(this, camelKey, value);
          if (key.indexOf("-") !== -1 && data !== undefined) {
            data_user.set(this, key, value);
          }
        });
      }, null, value, arguments.length > 1, null, true);
    },
    removeData: function(key) {
      return this.each(function() {
        data_user.remove(this, key);
      });
    }
  });
  jQuery.extend({
    queue: function(elem, type, data) {
      var queue;
      if (elem) {
        type = (type || "fx") + "queue";
        queue = data_priv.get(elem, type);
        if (data) {
          if (!queue || jQuery.isArray(data)) {
            queue = data_priv.access(elem, type, jQuery.makeArray(data));
          } else {
            queue.push(data);
          }
        }
        return queue || [];
      }
    },
    dequeue: function(elem, type) {
      type = type || "fx";
      var queue = jQuery.queue(elem, type),
          startLength = queue.length,
          fn = queue.shift(),
          hooks = jQuery._queueHooks(elem, type),
          next = function() {
            jQuery.dequeue(elem, type);
          };
      if (fn === "inprogress") {
        fn = queue.shift();
        startLength--;
      }
      if (fn) {
        if (type === "fx") {
          queue.unshift("inprogress");
        }
        delete hooks.stop;
        fn.call(elem, next, hooks);
      }
      if (!startLength && hooks) {
        hooks.empty.fire();
      }
    },
    _queueHooks: function(elem, type) {
      var key = type + "queueHooks";
      return data_priv.get(elem, key) || data_priv.access(elem, key, {empty: jQuery.Callbacks("once memory").add(function() {
          data_priv.remove(elem, [type + "queue", key]);
        })});
    }
  });
  jQuery.fn.extend({
    queue: function(type, data) {
      var setter = 2;
      if (typeof type !== "string") {
        data = type;
        type = "fx";
        setter--;
      }
      if (arguments.length < setter) {
        return jQuery.queue(this[0], type);
      }
      return data === undefined ? this : this.each(function() {
        var queue = jQuery.queue(this, type, data);
        jQuery._queueHooks(this, type);
        if (type === "fx" && queue[0] !== "inprogress") {
          jQuery.dequeue(this, type);
        }
      });
    },
    dequeue: function(type) {
      return this.each(function() {
        jQuery.dequeue(this, type);
      });
    },
    clearQueue: function(type) {
      return this.queue(type || "fx", []);
    },
    promise: function(type, obj) {
      var tmp,
          count = 1,
          defer = jQuery.Deferred(),
          elements = this,
          i = this.length,
          resolve = function() {
            if (!(--count)) {
              defer.resolveWith(elements, [elements]);
            }
          };
      if (typeof type !== "string") {
        obj = type;
        type = undefined;
      }
      type = type || "fx";
      while (i--) {
        tmp = data_priv.get(elements[i], type + "queueHooks");
        if (tmp && tmp.empty) {
          count++;
          tmp.empty.add(resolve);
        }
      }
      resolve();
      return defer.promise(obj);
    }
  });
  var pnum = (/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/).source;
  var cssExpand = ["Top", "Right", "Bottom", "Left"];
  var isHidden = function(elem, el) {
    elem = el || elem;
    return jQuery.css(elem, "display") === "none" || !jQuery.contains(elem.ownerDocument, elem);
  };
  var rcheckableType = (/^(?:checkbox|radio)$/i);
  (function() {
    var fragment = document.createDocumentFragment(),
        div = fragment.appendChild(document.createElement("div")),
        input = document.createElement("input");
    input.setAttribute("type", "radio");
    input.setAttribute("checked", "checked");
    input.setAttribute("name", "t");
    div.appendChild(input);
    support.checkClone = div.cloneNode(true).cloneNode(true).lastChild.checked;
    div.innerHTML = "<textarea>x</textarea>";
    support.noCloneChecked = !!div.cloneNode(true).lastChild.defaultValue;
  })();
  var strundefined = typeof undefined;
  support.focusinBubbles = "onfocusin" in window;
  var rkeyEvent = /^key/,
      rmouseEvent = /^(?:mouse|pointer|contextmenu)|click/,
      rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
      rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;
  function returnTrue() {
    return true;
  }
  function returnFalse() {
    return false;
  }
  function safeActiveElement() {
    try {
      return document.activeElement;
    } catch (err) {}
  }
  jQuery.event = {
    global: {},
    add: function(elem, types, handler, data, selector) {
      var handleObjIn,
          eventHandle,
          tmp,
          events,
          t,
          handleObj,
          special,
          handlers,
          type,
          namespaces,
          origType,
          elemData = data_priv.get(elem);
      if (!elemData) {
        return ;
      }
      if (handler.handler) {
        handleObjIn = handler;
        handler = handleObjIn.handler;
        selector = handleObjIn.selector;
      }
      if (!handler.guid) {
        handler.guid = jQuery.guid++;
      }
      if (!(events = elemData.events)) {
        events = elemData.events = {};
      }
      if (!(eventHandle = elemData.handle)) {
        eventHandle = elemData.handle = function(e) {
          return typeof jQuery !== strundefined && jQuery.event.triggered !== e.type ? jQuery.event.dispatch.apply(elem, arguments) : undefined;
        };
      }
      types = (types || "").match(rnotwhite) || [""];
      t = types.length;
      while (t--) {
        tmp = rtypenamespace.exec(types[t]) || [];
        type = origType = tmp[1];
        namespaces = (tmp[2] || "").split(".").sort();
        if (!type) {
          continue;
        }
        special = jQuery.event.special[type] || {};
        type = (selector ? special.delegateType : special.bindType) || type;
        special = jQuery.event.special[type] || {};
        handleObj = jQuery.extend({
          type: type,
          origType: origType,
          data: data,
          handler: handler,
          guid: handler.guid,
          selector: selector,
          needsContext: selector && jQuery.expr.match.needsContext.test(selector),
          namespace: namespaces.join(".")
        }, handleObjIn);
        if (!(handlers = events[type])) {
          handlers = events[type] = [];
          handlers.delegateCount = 0;
          if (!special.setup || special.setup.call(elem, data, namespaces, eventHandle) === false) {
            if (elem.addEventListener) {
              elem.addEventListener(type, eventHandle, false);
            }
          }
        }
        if (special.add) {
          special.add.call(elem, handleObj);
          if (!handleObj.handler.guid) {
            handleObj.handler.guid = handler.guid;
          }
        }
        if (selector) {
          handlers.splice(handlers.delegateCount++, 0, handleObj);
        } else {
          handlers.push(handleObj);
        }
        jQuery.event.global[type] = true;
      }
    },
    remove: function(elem, types, handler, selector, mappedTypes) {
      var j,
          origCount,
          tmp,
          events,
          t,
          handleObj,
          special,
          handlers,
          type,
          namespaces,
          origType,
          elemData = data_priv.hasData(elem) && data_priv.get(elem);
      if (!elemData || !(events = elemData.events)) {
        return ;
      }
      types = (types || "").match(rnotwhite) || [""];
      t = types.length;
      while (t--) {
        tmp = rtypenamespace.exec(types[t]) || [];
        type = origType = tmp[1];
        namespaces = (tmp[2] || "").split(".").sort();
        if (!type) {
          for (type in events) {
            jQuery.event.remove(elem, type + types[t], handler, selector, true);
          }
          continue;
        }
        special = jQuery.event.special[type] || {};
        type = (selector ? special.delegateType : special.bindType) || type;
        handlers = events[type] || [];
        tmp = tmp[2] && new RegExp("(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)");
        origCount = j = handlers.length;
        while (j--) {
          handleObj = handlers[j];
          if ((mappedTypes || origType === handleObj.origType) && (!handler || handler.guid === handleObj.guid) && (!tmp || tmp.test(handleObj.namespace)) && (!selector || selector === handleObj.selector || selector === "**" && handleObj.selector)) {
            handlers.splice(j, 1);
            if (handleObj.selector) {
              handlers.delegateCount--;
            }
            if (special.remove) {
              special.remove.call(elem, handleObj);
            }
          }
        }
        if (origCount && !handlers.length) {
          if (!special.teardown || special.teardown.call(elem, namespaces, elemData.handle) === false) {
            jQuery.removeEvent(elem, type, elemData.handle);
          }
          delete events[type];
        }
      }
      if (jQuery.isEmptyObject(events)) {
        delete elemData.handle;
        data_priv.remove(elem, "events");
      }
    },
    trigger: function(event, data, elem, onlyHandlers) {
      var i,
          cur,
          tmp,
          bubbleType,
          ontype,
          handle,
          special,
          eventPath = [elem || document],
          type = hasOwn.call(event, "type") ? event.type : event,
          namespaces = hasOwn.call(event, "namespace") ? event.namespace.split(".") : [];
      cur = tmp = elem = elem || document;
      if (elem.nodeType === 3 || elem.nodeType === 8) {
        return ;
      }
      if (rfocusMorph.test(type + jQuery.event.triggered)) {
        return ;
      }
      if (type.indexOf(".") >= 0) {
        namespaces = type.split(".");
        type = namespaces.shift();
        namespaces.sort();
      }
      ontype = type.indexOf(":") < 0 && "on" + type;
      event = event[jQuery.expando] ? event : new jQuery.Event(type, typeof event === "object" && event);
      event.isTrigger = onlyHandlers ? 2 : 3;
      event.namespace = namespaces.join(".");
      event.namespace_re = event.namespace ? new RegExp("(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)") : null;
      event.result = undefined;
      if (!event.target) {
        event.target = elem;
      }
      data = data == null ? [event] : jQuery.makeArray(data, [event]);
      special = jQuery.event.special[type] || {};
      if (!onlyHandlers && special.trigger && special.trigger.apply(elem, data) === false) {
        return ;
      }
      if (!onlyHandlers && !special.noBubble && !jQuery.isWindow(elem)) {
        bubbleType = special.delegateType || type;
        if (!rfocusMorph.test(bubbleType + type)) {
          cur = cur.parentNode;
        }
        for (; cur; cur = cur.parentNode) {
          eventPath.push(cur);
          tmp = cur;
        }
        if (tmp === (elem.ownerDocument || document)) {
          eventPath.push(tmp.defaultView || tmp.parentWindow || window);
        }
      }
      i = 0;
      while ((cur = eventPath[i++]) && !event.isPropagationStopped()) {
        event.type = i > 1 ? bubbleType : special.bindType || type;
        handle = (data_priv.get(cur, "events") || {})[event.type] && data_priv.get(cur, "handle");
        if (handle) {
          handle.apply(cur, data);
        }
        handle = ontype && cur[ontype];
        if (handle && handle.apply && jQuery.acceptData(cur)) {
          event.result = handle.apply(cur, data);
          if (event.result === false) {
            event.preventDefault();
          }
        }
      }
      event.type = type;
      if (!onlyHandlers && !event.isDefaultPrevented()) {
        if ((!special._default || special._default.apply(eventPath.pop(), data) === false) && jQuery.acceptData(elem)) {
          if (ontype && jQuery.isFunction(elem[type]) && !jQuery.isWindow(elem)) {
            tmp = elem[ontype];
            if (tmp) {
              elem[ontype] = null;
            }
            jQuery.event.triggered = type;
            elem[type]();
            jQuery.event.triggered = undefined;
            if (tmp) {
              elem[ontype] = tmp;
            }
          }
        }
      }
      return event.result;
    },
    dispatch: function(event) {
      event = jQuery.event.fix(event);
      var i,
          j,
          ret,
          matched,
          handleObj,
          handlerQueue = [],
          args = slice.call(arguments),
          handlers = (data_priv.get(this, "events") || {})[event.type] || [],
          special = jQuery.event.special[event.type] || {};
      args[0] = event;
      event.delegateTarget = this;
      if (special.preDispatch && special.preDispatch.call(this, event) === false) {
        return ;
      }
      handlerQueue = jQuery.event.handlers.call(this, event, handlers);
      i = 0;
      while ((matched = handlerQueue[i++]) && !event.isPropagationStopped()) {
        event.currentTarget = matched.elem;
        j = 0;
        while ((handleObj = matched.handlers[j++]) && !event.isImmediatePropagationStopped()) {
          if (!event.namespace_re || event.namespace_re.test(handleObj.namespace)) {
            event.handleObj = handleObj;
            event.data = handleObj.data;
            ret = ((jQuery.event.special[handleObj.origType] || {}).handle || handleObj.handler).apply(matched.elem, args);
            if (ret !== undefined) {
              if ((event.result = ret) === false) {
                event.preventDefault();
                event.stopPropagation();
              }
            }
          }
        }
      }
      if (special.postDispatch) {
        special.postDispatch.call(this, event);
      }
      return event.result;
    },
    handlers: function(event, handlers) {
      var i,
          matches,
          sel,
          handleObj,
          handlerQueue = [],
          delegateCount = handlers.delegateCount,
          cur = event.target;
      if (delegateCount && cur.nodeType && (!event.button || event.type !== "click")) {
        for (; cur !== this; cur = cur.parentNode || this) {
          if (cur.disabled !== true || event.type !== "click") {
            matches = [];
            for (i = 0; i < delegateCount; i++) {
              handleObj = handlers[i];
              sel = handleObj.selector + " ";
              if (matches[sel] === undefined) {
                matches[sel] = handleObj.needsContext ? jQuery(sel, this).index(cur) >= 0 : jQuery.find(sel, this, null, [cur]).length;
              }
              if (matches[sel]) {
                matches.push(handleObj);
              }
            }
            if (matches.length) {
              handlerQueue.push({
                elem: cur,
                handlers: matches
              });
            }
          }
        }
      }
      if (delegateCount < handlers.length) {
        handlerQueue.push({
          elem: this,
          handlers: handlers.slice(delegateCount)
        });
      }
      return handlerQueue;
    },
    props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),
    fixHooks: {},
    keyHooks: {
      props: "char charCode key keyCode".split(" "),
      filter: function(event, original) {
        if (event.which == null) {
          event.which = original.charCode != null ? original.charCode : original.keyCode;
        }
        return event;
      }
    },
    mouseHooks: {
      props: "button buttons clientX clientY offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
      filter: function(event, original) {
        var eventDoc,
            doc,
            body,
            button = original.button;
        if (event.pageX == null && original.clientX != null) {
          eventDoc = event.target.ownerDocument || document;
          doc = eventDoc.documentElement;
          body = eventDoc.body;
          event.pageX = original.clientX + (doc && doc.scrollLeft || body && body.scrollLeft || 0) - (doc && doc.clientLeft || body && body.clientLeft || 0);
          event.pageY = original.clientY + (doc && doc.scrollTop || body && body.scrollTop || 0) - (doc && doc.clientTop || body && body.clientTop || 0);
        }
        if (!event.which && button !== undefined) {
          event.which = (button & 1 ? 1 : (button & 2 ? 3 : (button & 4 ? 2 : 0)));
        }
        return event;
      }
    },
    fix: function(event) {
      if (event[jQuery.expando]) {
        return event;
      }
      var i,
          prop,
          copy,
          type = event.type,
          originalEvent = event,
          fixHook = this.fixHooks[type];
      if (!fixHook) {
        this.fixHooks[type] = fixHook = rmouseEvent.test(type) ? this.mouseHooks : rkeyEvent.test(type) ? this.keyHooks : {};
      }
      copy = fixHook.props ? this.props.concat(fixHook.props) : this.props;
      event = new jQuery.Event(originalEvent);
      i = copy.length;
      while (i--) {
        prop = copy[i];
        event[prop] = originalEvent[prop];
      }
      if (!event.target) {
        event.target = document;
      }
      if (event.target.nodeType === 3) {
        event.target = event.target.parentNode;
      }
      return fixHook.filter ? fixHook.filter(event, originalEvent) : event;
    },
    special: {
      load: {noBubble: true},
      focus: {
        trigger: function() {
          if (this !== safeActiveElement() && this.focus) {
            this.focus();
            return false;
          }
        },
        delegateType: "focusin"
      },
      blur: {
        trigger: function() {
          if (this === safeActiveElement() && this.blur) {
            this.blur();
            return false;
          }
        },
        delegateType: "focusout"
      },
      click: {
        trigger: function() {
          if (this.type === "checkbox" && this.click && jQuery.nodeName(this, "input")) {
            this.click();
            return false;
          }
        },
        _default: function(event) {
          return jQuery.nodeName(event.target, "a");
        }
      },
      beforeunload: {postDispatch: function(event) {
          if (event.result !== undefined && event.originalEvent) {
            event.originalEvent.returnValue = event.result;
          }
        }}
    },
    simulate: function(type, elem, event, bubble) {
      var e = jQuery.extend(new jQuery.Event(), event, {
        type: type,
        isSimulated: true,
        originalEvent: {}
      });
      if (bubble) {
        jQuery.event.trigger(e, null, elem);
      } else {
        jQuery.event.dispatch.call(elem, e);
      }
      if (e.isDefaultPrevented()) {
        event.preventDefault();
      }
    }
  };
  jQuery.removeEvent = function(elem, type, handle) {
    if (elem.removeEventListener) {
      elem.removeEventListener(type, handle, false);
    }
  };
  jQuery.Event = function(src, props) {
    if (!(this instanceof jQuery.Event)) {
      return new jQuery.Event(src, props);
    }
    if (src && src.type) {
      this.originalEvent = src;
      this.type = src.type;
      this.isDefaultPrevented = src.defaultPrevented || src.defaultPrevented === undefined && src.returnValue === false ? returnTrue : returnFalse;
    } else {
      this.type = src;
    }
    if (props) {
      jQuery.extend(this, props);
    }
    this.timeStamp = src && src.timeStamp || jQuery.now();
    this[jQuery.expando] = true;
  };
  jQuery.Event.prototype = {
    isDefaultPrevented: returnFalse,
    isPropagationStopped: returnFalse,
    isImmediatePropagationStopped: returnFalse,
    preventDefault: function() {
      var e = this.originalEvent;
      this.isDefaultPrevented = returnTrue;
      if (e && e.preventDefault) {
        e.preventDefault();
      }
    },
    stopPropagation: function() {
      var e = this.originalEvent;
      this.isPropagationStopped = returnTrue;
      if (e && e.stopPropagation) {
        e.stopPropagation();
      }
    },
    stopImmediatePropagation: function() {
      var e = this.originalEvent;
      this.isImmediatePropagationStopped = returnTrue;
      if (e && e.stopImmediatePropagation) {
        e.stopImmediatePropagation();
      }
      this.stopPropagation();
    }
  };
  jQuery.each({
    mouseenter: "mouseover",
    mouseleave: "mouseout",
    pointerenter: "pointerover",
    pointerleave: "pointerout"
  }, function(orig, fix) {
    jQuery.event.special[orig] = {
      delegateType: fix,
      bindType: fix,
      handle: function(event) {
        var ret,
            target = this,
            related = event.relatedTarget,
            handleObj = event.handleObj;
        if (!related || (related !== target && !jQuery.contains(target, related))) {
          event.type = handleObj.origType;
          ret = handleObj.handler.apply(this, arguments);
          event.type = fix;
        }
        return ret;
      }
    };
  });
  if (!support.focusinBubbles) {
    jQuery.each({
      focus: "focusin",
      blur: "focusout"
    }, function(orig, fix) {
      var handler = function(event) {
        jQuery.event.simulate(fix, event.target, jQuery.event.fix(event), true);
      };
      jQuery.event.special[fix] = {
        setup: function() {
          var doc = this.ownerDocument || this,
              attaches = data_priv.access(doc, fix);
          if (!attaches) {
            doc.addEventListener(orig, handler, true);
          }
          data_priv.access(doc, fix, (attaches || 0) + 1);
        },
        teardown: function() {
          var doc = this.ownerDocument || this,
              attaches = data_priv.access(doc, fix) - 1;
          if (!attaches) {
            doc.removeEventListener(orig, handler, true);
            data_priv.remove(doc, fix);
          } else {
            data_priv.access(doc, fix, attaches);
          }
        }
      };
    });
  }
  jQuery.fn.extend({
    on: function(types, selector, data, fn, one) {
      var origFn,
          type;
      if (typeof types === "object") {
        if (typeof selector !== "string") {
          data = data || selector;
          selector = undefined;
        }
        for (type in types) {
          this.on(type, selector, data, types[type], one);
        }
        return this;
      }
      if (data == null && fn == null) {
        fn = selector;
        data = selector = undefined;
      } else if (fn == null) {
        if (typeof selector === "string") {
          fn = data;
          data = undefined;
        } else {
          fn = data;
          data = selector;
          selector = undefined;
        }
      }
      if (fn === false) {
        fn = returnFalse;
      } else if (!fn) {
        return this;
      }
      if (one === 1) {
        origFn = fn;
        fn = function(event) {
          jQuery().off(event);
          return origFn.apply(this, arguments);
        };
        fn.guid = origFn.guid || (origFn.guid = jQuery.guid++);
      }
      return this.each(function() {
        jQuery.event.add(this, types, fn, data, selector);
      });
    },
    one: function(types, selector, data, fn) {
      return this.on(types, selector, data, fn, 1);
    },
    off: function(types, selector, fn) {
      var handleObj,
          type;
      if (types && types.preventDefault && types.handleObj) {
        handleObj = types.handleObj;
        jQuery(types.delegateTarget).off(handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType, handleObj.selector, handleObj.handler);
        return this;
      }
      if (typeof types === "object") {
        for (type in types) {
          this.off(type, selector, types[type]);
        }
        return this;
      }
      if (selector === false || typeof selector === "function") {
        fn = selector;
        selector = undefined;
      }
      if (fn === false) {
        fn = returnFalse;
      }
      return this.each(function() {
        jQuery.event.remove(this, types, fn, selector);
      });
    },
    trigger: function(type, data) {
      return this.each(function() {
        jQuery.event.trigger(type, data, this);
      });
    },
    triggerHandler: function(type, data) {
      var elem = this[0];
      if (elem) {
        return jQuery.event.trigger(type, data, elem, true);
      }
    }
  });
  var rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
      rtagName = /<([\w:]+)/,
      rhtml = /<|&#?\w+;/,
      rnoInnerhtml = /<(?:script|style|link)/i,
      rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
      rscriptType = /^$|\/(?:java|ecma)script/i,
      rscriptTypeMasked = /^true\/(.*)/,
      rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,
      wrapMap = {
        option: [1, "<select multiple='multiple'>", "</select>"],
        thead: [1, "<table>", "</table>"],
        col: [2, "<table><colgroup>", "</colgroup></table>"],
        tr: [2, "<table><tbody>", "</tbody></table>"],
        td: [3, "<table><tbody><tr>", "</tr></tbody></table>"],
        _default: [0, "", ""]
      };
  wrapMap.optgroup = wrapMap.option;
  wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
  wrapMap.th = wrapMap.td;
  function manipulationTarget(elem, content) {
    return jQuery.nodeName(elem, "table") && jQuery.nodeName(content.nodeType !== 11 ? content : content.firstChild, "tr") ? elem.getElementsByTagName("tbody")[0] || elem.appendChild(elem.ownerDocument.createElement("tbody")) : elem;
  }
  function disableScript(elem) {
    elem.type = (elem.getAttribute("type") !== null) + "/" + elem.type;
    return elem;
  }
  function restoreScript(elem) {
    var match = rscriptTypeMasked.exec(elem.type);
    if (match) {
      elem.type = match[1];
    } else {
      elem.removeAttribute("type");
    }
    return elem;
  }
  function setGlobalEval(elems, refElements) {
    var i = 0,
        l = elems.length;
    for (; i < l; i++) {
      data_priv.set(elems[i], "globalEval", !refElements || data_priv.get(refElements[i], "globalEval"));
    }
  }
  function cloneCopyEvent(src, dest) {
    var i,
        l,
        type,
        pdataOld,
        pdataCur,
        udataOld,
        udataCur,
        events;
    if (dest.nodeType !== 1) {
      return ;
    }
    if (data_priv.hasData(src)) {
      pdataOld = data_priv.access(src);
      pdataCur = data_priv.set(dest, pdataOld);
      events = pdataOld.events;
      if (events) {
        delete pdataCur.handle;
        pdataCur.events = {};
        for (type in events) {
          for (i = 0, l = events[type].length; i < l; i++) {
            jQuery.event.add(dest, type, events[type][i]);
          }
        }
      }
    }
    if (data_user.hasData(src)) {
      udataOld = data_user.access(src);
      udataCur = jQuery.extend({}, udataOld);
      data_user.set(dest, udataCur);
    }
  }
  function getAll(context, tag) {
    var ret = context.getElementsByTagName ? context.getElementsByTagName(tag || "*") : context.querySelectorAll ? context.querySelectorAll(tag || "*") : [];
    return tag === undefined || tag && jQuery.nodeName(context, tag) ? jQuery.merge([context], ret) : ret;
  }
  function fixInput(src, dest) {
    var nodeName = dest.nodeName.toLowerCase();
    if (nodeName === "input" && rcheckableType.test(src.type)) {
      dest.checked = src.checked;
    } else if (nodeName === "input" || nodeName === "textarea") {
      dest.defaultValue = src.defaultValue;
    }
  }
  jQuery.extend({
    clone: function(elem, dataAndEvents, deepDataAndEvents) {
      var i,
          l,
          srcElements,
          destElements,
          clone = elem.cloneNode(true),
          inPage = jQuery.contains(elem.ownerDocument, elem);
      if (!support.noCloneChecked && (elem.nodeType === 1 || elem.nodeType === 11) && !jQuery.isXMLDoc(elem)) {
        destElements = getAll(clone);
        srcElements = getAll(elem);
        for (i = 0, l = srcElements.length; i < l; i++) {
          fixInput(srcElements[i], destElements[i]);
        }
      }
      if (dataAndEvents) {
        if (deepDataAndEvents) {
          srcElements = srcElements || getAll(elem);
          destElements = destElements || getAll(clone);
          for (i = 0, l = srcElements.length; i < l; i++) {
            cloneCopyEvent(srcElements[i], destElements[i]);
          }
        } else {
          cloneCopyEvent(elem, clone);
        }
      }
      destElements = getAll(clone, "script");
      if (destElements.length > 0) {
        setGlobalEval(destElements, !inPage && getAll(elem, "script"));
      }
      return clone;
    },
    buildFragment: function(elems, context, scripts, selection) {
      var elem,
          tmp,
          tag,
          wrap,
          contains,
          j,
          fragment = context.createDocumentFragment(),
          nodes = [],
          i = 0,
          l = elems.length;
      for (; i < l; i++) {
        elem = elems[i];
        if (elem || elem === 0) {
          if (jQuery.type(elem) === "object") {
            jQuery.merge(nodes, elem.nodeType ? [elem] : elem);
          } else if (!rhtml.test(elem)) {
            nodes.push(context.createTextNode(elem));
          } else {
            tmp = tmp || fragment.appendChild(context.createElement("div"));
            tag = (rtagName.exec(elem) || ["", ""])[1].toLowerCase();
            wrap = wrapMap[tag] || wrapMap._default;
            tmp.innerHTML = wrap[1] + elem.replace(rxhtmlTag, "<$1></$2>") + wrap[2];
            j = wrap[0];
            while (j--) {
              tmp = tmp.lastChild;
            }
            jQuery.merge(nodes, tmp.childNodes);
            tmp = fragment.firstChild;
            tmp.textContent = "";
          }
        }
      }
      fragment.textContent = "";
      i = 0;
      while ((elem = nodes[i++])) {
        if (selection && jQuery.inArray(elem, selection) !== -1) {
          continue;
        }
        contains = jQuery.contains(elem.ownerDocument, elem);
        tmp = getAll(fragment.appendChild(elem), "script");
        if (contains) {
          setGlobalEval(tmp);
        }
        if (scripts) {
          j = 0;
          while ((elem = tmp[j++])) {
            if (rscriptType.test(elem.type || "")) {
              scripts.push(elem);
            }
          }
        }
      }
      return fragment;
    },
    cleanData: function(elems) {
      var data,
          elem,
          type,
          key,
          special = jQuery.event.special,
          i = 0;
      for (; (elem = elems[i]) !== undefined; i++) {
        if (jQuery.acceptData(elem)) {
          key = elem[data_priv.expando];
          if (key && (data = data_priv.cache[key])) {
            if (data.events) {
              for (type in data.events) {
                if (special[type]) {
                  jQuery.event.remove(elem, type);
                } else {
                  jQuery.removeEvent(elem, type, data.handle);
                }
              }
            }
            if (data_priv.cache[key]) {
              delete data_priv.cache[key];
            }
          }
        }
        delete data_user.cache[elem[data_user.expando]];
      }
    }
  });
  jQuery.fn.extend({
    text: function(value) {
      return access(this, function(value) {
        return value === undefined ? jQuery.text(this) : this.empty().each(function() {
          if (this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9) {
            this.textContent = value;
          }
        });
      }, null, value, arguments.length);
    },
    append: function() {
      return this.domManip(arguments, function(elem) {
        if (this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9) {
          var target = manipulationTarget(this, elem);
          target.appendChild(elem);
        }
      });
    },
    prepend: function() {
      return this.domManip(arguments, function(elem) {
        if (this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9) {
          var target = manipulationTarget(this, elem);
          target.insertBefore(elem, target.firstChild);
        }
      });
    },
    before: function() {
      return this.domManip(arguments, function(elem) {
        if (this.parentNode) {
          this.parentNode.insertBefore(elem, this);
        }
      });
    },
    after: function() {
      return this.domManip(arguments, function(elem) {
        if (this.parentNode) {
          this.parentNode.insertBefore(elem, this.nextSibling);
        }
      });
    },
    remove: function(selector, keepData) {
      var elem,
          elems = selector ? jQuery.filter(selector, this) : this,
          i = 0;
      for (; (elem = elems[i]) != null; i++) {
        if (!keepData && elem.nodeType === 1) {
          jQuery.cleanData(getAll(elem));
        }
        if (elem.parentNode) {
          if (keepData && jQuery.contains(elem.ownerDocument, elem)) {
            setGlobalEval(getAll(elem, "script"));
          }
          elem.parentNode.removeChild(elem);
        }
      }
      return this;
    },
    empty: function() {
      var elem,
          i = 0;
      for (; (elem = this[i]) != null; i++) {
        if (elem.nodeType === 1) {
          jQuery.cleanData(getAll(elem, false));
          elem.textContent = "";
        }
      }
      return this;
    },
    clone: function(dataAndEvents, deepDataAndEvents) {
      dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
      deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;
      return this.map(function() {
        return jQuery.clone(this, dataAndEvents, deepDataAndEvents);
      });
    },
    html: function(value) {
      return access(this, function(value) {
        var elem = this[0] || {},
            i = 0,
            l = this.length;
        if (value === undefined && elem.nodeType === 1) {
          return elem.innerHTML;
        }
        if (typeof value === "string" && !rnoInnerhtml.test(value) && !wrapMap[(rtagName.exec(value) || ["", ""])[1].toLowerCase()]) {
          value = value.replace(rxhtmlTag, "<$1></$2>");
          try {
            for (; i < l; i++) {
              elem = this[i] || {};
              if (elem.nodeType === 1) {
                jQuery.cleanData(getAll(elem, false));
                elem.innerHTML = value;
              }
            }
            elem = 0;
          } catch (e) {}
        }
        if (elem) {
          this.empty().append(value);
        }
      }, null, value, arguments.length);
    },
    replaceWith: function() {
      var arg = arguments[0];
      this.domManip(arguments, function(elem) {
        arg = this.parentNode;
        jQuery.cleanData(getAll(this));
        if (arg) {
          arg.replaceChild(elem, this);
        }
      });
      return arg && (arg.length || arg.nodeType) ? this : this.remove();
    },
    detach: function(selector) {
      return this.remove(selector, true);
    },
    domManip: function(args, callback) {
      args = concat.apply([], args);
      var fragment,
          first,
          scripts,
          hasScripts,
          node,
          doc,
          i = 0,
          l = this.length,
          set = this,
          iNoClone = l - 1,
          value = args[0],
          isFunction = jQuery.isFunction(value);
      if (isFunction || (l > 1 && typeof value === "string" && !support.checkClone && rchecked.test(value))) {
        return this.each(function(index) {
          var self = set.eq(index);
          if (isFunction) {
            args[0] = value.call(this, index, self.html());
          }
          self.domManip(args, callback);
        });
      }
      if (l) {
        fragment = jQuery.buildFragment(args, this[0].ownerDocument, false, this);
        first = fragment.firstChild;
        if (fragment.childNodes.length === 1) {
          fragment = first;
        }
        if (first) {
          scripts = jQuery.map(getAll(fragment, "script"), disableScript);
          hasScripts = scripts.length;
          for (; i < l; i++) {
            node = fragment;
            if (i !== iNoClone) {
              node = jQuery.clone(node, true, true);
              if (hasScripts) {
                jQuery.merge(scripts, getAll(node, "script"));
              }
            }
            callback.call(this[i], node, i);
          }
          if (hasScripts) {
            doc = scripts[scripts.length - 1].ownerDocument;
            jQuery.map(scripts, restoreScript);
            for (i = 0; i < hasScripts; i++) {
              node = scripts[i];
              if (rscriptType.test(node.type || "") && !data_priv.access(node, "globalEval") && jQuery.contains(doc, node)) {
                if (node.src) {
                  if (jQuery._evalUrl) {
                    jQuery._evalUrl(node.src);
                  }
                } else {
                  jQuery.globalEval(node.textContent.replace(rcleanScript, ""));
                }
              }
            }
          }
        }
      }
      return this;
    }
  });
  jQuery.each({
    appendTo: "append",
    prependTo: "prepend",
    insertBefore: "before",
    insertAfter: "after",
    replaceAll: "replaceWith"
  }, function(name, original) {
    jQuery.fn[name] = function(selector) {
      var elems,
          ret = [],
          insert = jQuery(selector),
          last = insert.length - 1,
          i = 0;
      for (; i <= last; i++) {
        elems = i === last ? this : this.clone(true);
        jQuery(insert[i])[original](elems);
        push.apply(ret, elems.get());
      }
      return this.pushStack(ret);
    };
  });
  var iframe,
      elemdisplay = {};
  function actualDisplay(name, doc) {
    var style,
        elem = jQuery(doc.createElement(name)).appendTo(doc.body),
        display = window.getDefaultComputedStyle && (style = window.getDefaultComputedStyle(elem[0])) ? style.display : jQuery.css(elem[0], "display");
    elem.detach();
    return display;
  }
  function defaultDisplay(nodeName) {
    var doc = document,
        display = elemdisplay[nodeName];
    if (!display) {
      display = actualDisplay(nodeName, doc);
      if (display === "none" || !display) {
        iframe = (iframe || jQuery("<iframe frameborder='0' width='0' height='0'/>")).appendTo(doc.documentElement);
        doc = iframe[0].contentDocument;
        doc.write();
        doc.close();
        display = actualDisplay(nodeName, doc);
        iframe.detach();
      }
      elemdisplay[nodeName] = display;
    }
    return display;
  }
  var rmargin = (/^margin/);
  var rnumnonpx = new RegExp("^(" + pnum + ")(?!px)[a-z%]+$", "i");
  var getStyles = function(elem) {
    if (elem.ownerDocument.defaultView.opener) {
      return elem.ownerDocument.defaultView.getComputedStyle(elem, null);
    }
    return window.getComputedStyle(elem, null);
  };
  function curCSS(elem, name, computed) {
    var width,
        minWidth,
        maxWidth,
        ret,
        style = elem.style;
    computed = computed || getStyles(elem);
    if (computed) {
      ret = computed.getPropertyValue(name) || computed[name];
    }
    if (computed) {
      if (ret === "" && !jQuery.contains(elem.ownerDocument, elem)) {
        ret = jQuery.style(elem, name);
      }
      if (rnumnonpx.test(ret) && rmargin.test(name)) {
        width = style.width;
        minWidth = style.minWidth;
        maxWidth = style.maxWidth;
        style.minWidth = style.maxWidth = style.width = ret;
        ret = computed.width;
        style.width = width;
        style.minWidth = minWidth;
        style.maxWidth = maxWidth;
      }
    }
    return ret !== undefined ? ret + "" : ret;
  }
  function addGetHookIf(conditionFn, hookFn) {
    return {get: function() {
        if (conditionFn()) {
          delete this.get;
          return ;
        }
        return (this.get = hookFn).apply(this, arguments);
      }};
  }
  (function() {
    var pixelPositionVal,
        boxSizingReliableVal,
        docElem = document.documentElement,
        container = document.createElement("div"),
        div = document.createElement("div");
    if (!div.style) {
      return ;
    }
    div.style.backgroundClip = "content-box";
    div.cloneNode(true).style.backgroundClip = "";
    support.clearCloneStyle = div.style.backgroundClip === "content-box";
    container.style.cssText = "border:0;width:0;height:0;top:0;left:-9999px;margin-top:1px;" + "position:absolute";
    container.appendChild(div);
    function computePixelPositionAndBoxSizingReliable() {
      div.style.cssText = "-webkit-box-sizing:border-box;-moz-box-sizing:border-box;" + "box-sizing:border-box;display:block;margin-top:1%;top:1%;" + "border:1px;padding:1px;width:4px;position:absolute";
      div.innerHTML = "";
      docElem.appendChild(container);
      var divStyle = window.getComputedStyle(div, null);
      pixelPositionVal = divStyle.top !== "1%";
      boxSizingReliableVal = divStyle.width === "4px";
      docElem.removeChild(container);
    }
    if (window.getComputedStyle) {
      jQuery.extend(support, {
        pixelPosition: function() {
          computePixelPositionAndBoxSizingReliable();
          return pixelPositionVal;
        },
        boxSizingReliable: function() {
          if (boxSizingReliableVal == null) {
            computePixelPositionAndBoxSizingReliable();
          }
          return boxSizingReliableVal;
        },
        reliableMarginRight: function() {
          var ret,
              marginDiv = div.appendChild(document.createElement("div"));
          marginDiv.style.cssText = div.style.cssText = "-webkit-box-sizing:content-box;-moz-box-sizing:content-box;" + "box-sizing:content-box;display:block;margin:0;border:0;padding:0";
          marginDiv.style.marginRight = marginDiv.style.width = "0";
          div.style.width = "1px";
          docElem.appendChild(container);
          ret = !parseFloat(window.getComputedStyle(marginDiv, null).marginRight);
          docElem.removeChild(container);
          div.removeChild(marginDiv);
          return ret;
        }
      });
    }
  })();
  jQuery.swap = function(elem, options, callback, args) {
    var ret,
        name,
        old = {};
    for (name in options) {
      old[name] = elem.style[name];
      elem.style[name] = options[name];
    }
    ret = callback.apply(elem, args || []);
    for (name in options) {
      elem.style[name] = old[name];
    }
    return ret;
  };
  var rdisplayswap = /^(none|table(?!-c[ea]).+)/,
      rnumsplit = new RegExp("^(" + pnum + ")(.*)$", "i"),
      rrelNum = new RegExp("^([+-])=(" + pnum + ")", "i"),
      cssShow = {
        position: "absolute",
        visibility: "hidden",
        display: "block"
      },
      cssNormalTransform = {
        letterSpacing: "0",
        fontWeight: "400"
      },
      cssPrefixes = ["Webkit", "O", "Moz", "ms"];
  function vendorPropName(style, name) {
    if (name in style) {
      return name;
    }
    var capName = name[0].toUpperCase() + name.slice(1),
        origName = name,
        i = cssPrefixes.length;
    while (i--) {
      name = cssPrefixes[i] + capName;
      if (name in style) {
        return name;
      }
    }
    return origName;
  }
  function setPositiveNumber(elem, value, subtract) {
    var matches = rnumsplit.exec(value);
    return matches ? Math.max(0, matches[1] - (subtract || 0)) + (matches[2] || "px") : value;
  }
  function augmentWidthOrHeight(elem, name, extra, isBorderBox, styles) {
    var i = extra === (isBorderBox ? "border" : "content") ? 4 : name === "width" ? 1 : 0,
        val = 0;
    for (; i < 4; i += 2) {
      if (extra === "margin") {
        val += jQuery.css(elem, extra + cssExpand[i], true, styles);
      }
      if (isBorderBox) {
        if (extra === "content") {
          val -= jQuery.css(elem, "padding" + cssExpand[i], true, styles);
        }
        if (extra !== "margin") {
          val -= jQuery.css(elem, "border" + cssExpand[i] + "Width", true, styles);
        }
      } else {
        val += jQuery.css(elem, "padding" + cssExpand[i], true, styles);
        if (extra !== "padding") {
          val += jQuery.css(elem, "border" + cssExpand[i] + "Width", true, styles);
        }
      }
    }
    return val;
  }
  function getWidthOrHeight(elem, name, extra) {
    var valueIsBorderBox = true,
        val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
        styles = getStyles(elem),
        isBorderBox = jQuery.css(elem, "boxSizing", false, styles) === "border-box";
    if (val <= 0 || val == null) {
      val = curCSS(elem, name, styles);
      if (val < 0 || val == null) {
        val = elem.style[name];
      }
      if (rnumnonpx.test(val)) {
        return val;
      }
      valueIsBorderBox = isBorderBox && (support.boxSizingReliable() || val === elem.style[name]);
      val = parseFloat(val) || 0;
    }
    return (val + augmentWidthOrHeight(elem, name, extra || (isBorderBox ? "border" : "content"), valueIsBorderBox, styles)) + "px";
  }
  function showHide(elements, show) {
    var display,
        elem,
        hidden,
        values = [],
        index = 0,
        length = elements.length;
    for (; index < length; index++) {
      elem = elements[index];
      if (!elem.style) {
        continue;
      }
      values[index] = data_priv.get(elem, "olddisplay");
      display = elem.style.display;
      if (show) {
        if (!values[index] && display === "none") {
          elem.style.display = "";
        }
        if (elem.style.display === "" && isHidden(elem)) {
          values[index] = data_priv.access(elem, "olddisplay", defaultDisplay(elem.nodeName));
        }
      } else {
        hidden = isHidden(elem);
        if (display !== "none" || !hidden) {
          data_priv.set(elem, "olddisplay", hidden ? display : jQuery.css(elem, "display"));
        }
      }
    }
    for (index = 0; index < length; index++) {
      elem = elements[index];
      if (!elem.style) {
        continue;
      }
      if (!show || elem.style.display === "none" || elem.style.display === "") {
        elem.style.display = show ? values[index] || "" : "none";
      }
    }
    return elements;
  }
  jQuery.extend({
    cssHooks: {opacity: {get: function(elem, computed) {
          if (computed) {
            var ret = curCSS(elem, "opacity");
            return ret === "" ? "1" : ret;
          }
        }}},
    cssNumber: {
      "columnCount": true,
      "fillOpacity": true,
      "flexGrow": true,
      "flexShrink": true,
      "fontWeight": true,
      "lineHeight": true,
      "opacity": true,
      "order": true,
      "orphans": true,
      "widows": true,
      "zIndex": true,
      "zoom": true
    },
    cssProps: {"float": "cssFloat"},
    style: function(elem, name, value, extra) {
      if (!elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style) {
        return ;
      }
      var ret,
          type,
          hooks,
          origName = jQuery.camelCase(name),
          style = elem.style;
      name = jQuery.cssProps[origName] || (jQuery.cssProps[origName] = vendorPropName(style, origName));
      hooks = jQuery.cssHooks[name] || jQuery.cssHooks[origName];
      if (value !== undefined) {
        type = typeof value;
        if (type === "string" && (ret = rrelNum.exec(value))) {
          value = (ret[1] + 1) * ret[2] + parseFloat(jQuery.css(elem, name));
          type = "number";
        }
        if (value == null || value !== value) {
          return ;
        }
        if (type === "number" && !jQuery.cssNumber[origName]) {
          value += "px";
        }
        if (!support.clearCloneStyle && value === "" && name.indexOf("background") === 0) {
          style[name] = "inherit";
        }
        if (!hooks || !("set" in hooks) || (value = hooks.set(elem, value, extra)) !== undefined) {
          style[name] = value;
        }
      } else {
        if (hooks && "get" in hooks && (ret = hooks.get(elem, false, extra)) !== undefined) {
          return ret;
        }
        return style[name];
      }
    },
    css: function(elem, name, extra, styles) {
      var val,
          num,
          hooks,
          origName = jQuery.camelCase(name);
      name = jQuery.cssProps[origName] || (jQuery.cssProps[origName] = vendorPropName(elem.style, origName));
      hooks = jQuery.cssHooks[name] || jQuery.cssHooks[origName];
      if (hooks && "get" in hooks) {
        val = hooks.get(elem, true, extra);
      }
      if (val === undefined) {
        val = curCSS(elem, name, styles);
      }
      if (val === "normal" && name in cssNormalTransform) {
        val = cssNormalTransform[name];
      }
      if (extra === "" || extra) {
        num = parseFloat(val);
        return extra === true || jQuery.isNumeric(num) ? num || 0 : val;
      }
      return val;
    }
  });
  jQuery.each(["height", "width"], function(i, name) {
    jQuery.cssHooks[name] = {
      get: function(elem, computed, extra) {
        if (computed) {
          return rdisplayswap.test(jQuery.css(elem, "display")) && elem.offsetWidth === 0 ? jQuery.swap(elem, cssShow, function() {
            return getWidthOrHeight(elem, name, extra);
          }) : getWidthOrHeight(elem, name, extra);
        }
      },
      set: function(elem, value, extra) {
        var styles = extra && getStyles(elem);
        return setPositiveNumber(elem, value, extra ? augmentWidthOrHeight(elem, name, extra, jQuery.css(elem, "boxSizing", false, styles) === "border-box", styles) : 0);
      }
    };
  });
  jQuery.cssHooks.marginRight = addGetHookIf(support.reliableMarginRight, function(elem, computed) {
    if (computed) {
      return jQuery.swap(elem, {"display": "inline-block"}, curCSS, [elem, "marginRight"]);
    }
  });
  jQuery.each({
    margin: "",
    padding: "",
    border: "Width"
  }, function(prefix, suffix) {
    jQuery.cssHooks[prefix + suffix] = {expand: function(value) {
        var i = 0,
            expanded = {},
            parts = typeof value === "string" ? value.split(" ") : [value];
        for (; i < 4; i++) {
          expanded[prefix + cssExpand[i] + suffix] = parts[i] || parts[i - 2] || parts[0];
        }
        return expanded;
      }};
    if (!rmargin.test(prefix)) {
      jQuery.cssHooks[prefix + suffix].set = setPositiveNumber;
    }
  });
  jQuery.fn.extend({
    css: function(name, value) {
      return access(this, function(elem, name, value) {
        var styles,
            len,
            map = {},
            i = 0;
        if (jQuery.isArray(name)) {
          styles = getStyles(elem);
          len = name.length;
          for (; i < len; i++) {
            map[name[i]] = jQuery.css(elem, name[i], false, styles);
          }
          return map;
        }
        return value !== undefined ? jQuery.style(elem, name, value) : jQuery.css(elem, name);
      }, name, value, arguments.length > 1);
    },
    show: function() {
      return showHide(this, true);
    },
    hide: function() {
      return showHide(this);
    },
    toggle: function(state) {
      if (typeof state === "boolean") {
        return state ? this.show() : this.hide();
      }
      return this.each(function() {
        if (isHidden(this)) {
          jQuery(this).show();
        } else {
          jQuery(this).hide();
        }
      });
    }
  });
  function Tween(elem, options, prop, end, easing) {
    return new Tween.prototype.init(elem, options, prop, end, easing);
  }
  jQuery.Tween = Tween;
  Tween.prototype = {
    constructor: Tween,
    init: function(elem, options, prop, end, easing, unit) {
      this.elem = elem;
      this.prop = prop;
      this.easing = easing || "swing";
      this.options = options;
      this.start = this.now = this.cur();
      this.end = end;
      this.unit = unit || (jQuery.cssNumber[prop] ? "" : "px");
    },
    cur: function() {
      var hooks = Tween.propHooks[this.prop];
      return hooks && hooks.get ? hooks.get(this) : Tween.propHooks._default.get(this);
    },
    run: function(percent) {
      var eased,
          hooks = Tween.propHooks[this.prop];
      if (this.options.duration) {
        this.pos = eased = jQuery.easing[this.easing](percent, this.options.duration * percent, 0, 1, this.options.duration);
      } else {
        this.pos = eased = percent;
      }
      this.now = (this.end - this.start) * eased + this.start;
      if (this.options.step) {
        this.options.step.call(this.elem, this.now, this);
      }
      if (hooks && hooks.set) {
        hooks.set(this);
      } else {
        Tween.propHooks._default.set(this);
      }
      return this;
    }
  };
  Tween.prototype.init.prototype = Tween.prototype;
  Tween.propHooks = {_default: {
      get: function(tween) {
        var result;
        if (tween.elem[tween.prop] != null && (!tween.elem.style || tween.elem.style[tween.prop] == null)) {
          return tween.elem[tween.prop];
        }
        result = jQuery.css(tween.elem, tween.prop, "");
        return !result || result === "auto" ? 0 : result;
      },
      set: function(tween) {
        if (jQuery.fx.step[tween.prop]) {
          jQuery.fx.step[tween.prop](tween);
        } else if (tween.elem.style && (tween.elem.style[jQuery.cssProps[tween.prop]] != null || jQuery.cssHooks[tween.prop])) {
          jQuery.style(tween.elem, tween.prop, tween.now + tween.unit);
        } else {
          tween.elem[tween.prop] = tween.now;
        }
      }
    }};
  Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {set: function(tween) {
      if (tween.elem.nodeType && tween.elem.parentNode) {
        tween.elem[tween.prop] = tween.now;
      }
    }};
  jQuery.easing = {
    linear: function(p) {
      return p;
    },
    swing: function(p) {
      return 0.5 - Math.cos(p * Math.PI) / 2;
    }
  };
  jQuery.fx = Tween.prototype.init;
  jQuery.fx.step = {};
  var fxNow,
      timerId,
      rfxtypes = /^(?:toggle|show|hide)$/,
      rfxnum = new RegExp("^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i"),
      rrun = /queueHooks$/,
      animationPrefilters = [defaultPrefilter],
      tweeners = {"*": [function(prop, value) {
          var tween = this.createTween(prop, value),
              target = tween.cur(),
              parts = rfxnum.exec(value),
              unit = parts && parts[3] || (jQuery.cssNumber[prop] ? "" : "px"),
              start = (jQuery.cssNumber[prop] || unit !== "px" && +target) && rfxnum.exec(jQuery.css(tween.elem, prop)),
              scale = 1,
              maxIterations = 20;
          if (start && start[3] !== unit) {
            unit = unit || start[3];
            parts = parts || [];
            start = +target || 1;
            do {
              scale = scale || ".5";
              start = start / scale;
              jQuery.style(tween.elem, prop, start + unit);
            } while (scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations);
          }
          if (parts) {
            start = tween.start = +start || +target || 0;
            tween.unit = unit;
            tween.end = parts[1] ? start + (parts[1] + 1) * parts[2] : +parts[2];
          }
          return tween;
        }]};
  function createFxNow() {
    setTimeout(function() {
      fxNow = undefined;
    });
    return (fxNow = jQuery.now());
  }
  function genFx(type, includeWidth) {
    var which,
        i = 0,
        attrs = {height: type};
    includeWidth = includeWidth ? 1 : 0;
    for (; i < 4; i += 2 - includeWidth) {
      which = cssExpand[i];
      attrs["margin" + which] = attrs["padding" + which] = type;
    }
    if (includeWidth) {
      attrs.opacity = attrs.width = type;
    }
    return attrs;
  }
  function createTween(value, prop, animation) {
    var tween,
        collection = (tweeners[prop] || []).concat(tweeners["*"]),
        index = 0,
        length = collection.length;
    for (; index < length; index++) {
      if ((tween = collection[index].call(animation, prop, value))) {
        return tween;
      }
    }
  }
  function defaultPrefilter(elem, props, opts) {
    var prop,
        value,
        toggle,
        tween,
        hooks,
        oldfire,
        display,
        checkDisplay,
        anim = this,
        orig = {},
        style = elem.style,
        hidden = elem.nodeType && isHidden(elem),
        dataShow = data_priv.get(elem, "fxshow");
    if (!opts.queue) {
      hooks = jQuery._queueHooks(elem, "fx");
      if (hooks.unqueued == null) {
        hooks.unqueued = 0;
        oldfire = hooks.empty.fire;
        hooks.empty.fire = function() {
          if (!hooks.unqueued) {
            oldfire();
          }
        };
      }
      hooks.unqueued++;
      anim.always(function() {
        anim.always(function() {
          hooks.unqueued--;
          if (!jQuery.queue(elem, "fx").length) {
            hooks.empty.fire();
          }
        });
      });
    }
    if (elem.nodeType === 1 && ("height" in props || "width" in props)) {
      opts.overflow = [style.overflow, style.overflowX, style.overflowY];
      display = jQuery.css(elem, "display");
      checkDisplay = display === "none" ? data_priv.get(elem, "olddisplay") || defaultDisplay(elem.nodeName) : display;
      if (checkDisplay === "inline" && jQuery.css(elem, "float") === "none") {
        style.display = "inline-block";
      }
    }
    if (opts.overflow) {
      style.overflow = "hidden";
      anim.always(function() {
        style.overflow = opts.overflow[0];
        style.overflowX = opts.overflow[1];
        style.overflowY = opts.overflow[2];
      });
    }
    for (prop in props) {
      value = props[prop];
      if (rfxtypes.exec(value)) {
        delete props[prop];
        toggle = toggle || value === "toggle";
        if (value === (hidden ? "hide" : "show")) {
          if (value === "show" && dataShow && dataShow[prop] !== undefined) {
            hidden = true;
          } else {
            continue;
          }
        }
        orig[prop] = dataShow && dataShow[prop] || jQuery.style(elem, prop);
      } else {
        display = undefined;
      }
    }
    if (!jQuery.isEmptyObject(orig)) {
      if (dataShow) {
        if ("hidden" in dataShow) {
          hidden = dataShow.hidden;
        }
      } else {
        dataShow = data_priv.access(elem, "fxshow", {});
      }
      if (toggle) {
        dataShow.hidden = !hidden;
      }
      if (hidden) {
        jQuery(elem).show();
      } else {
        anim.done(function() {
          jQuery(elem).hide();
        });
      }
      anim.done(function() {
        var prop;
        data_priv.remove(elem, "fxshow");
        for (prop in orig) {
          jQuery.style(elem, prop, orig[prop]);
        }
      });
      for (prop in orig) {
        tween = createTween(hidden ? dataShow[prop] : 0, prop, anim);
        if (!(prop in dataShow)) {
          dataShow[prop] = tween.start;
          if (hidden) {
            tween.end = tween.start;
            tween.start = prop === "width" || prop === "height" ? 1 : 0;
          }
        }
      }
    } else if ((display === "none" ? defaultDisplay(elem.nodeName) : display) === "inline") {
      style.display = display;
    }
  }
  function propFilter(props, specialEasing) {
    var index,
        name,
        easing,
        value,
        hooks;
    for (index in props) {
      name = jQuery.camelCase(index);
      easing = specialEasing[name];
      value = props[index];
      if (jQuery.isArray(value)) {
        easing = value[1];
        value = props[index] = value[0];
      }
      if (index !== name) {
        props[name] = value;
        delete props[index];
      }
      hooks = jQuery.cssHooks[name];
      if (hooks && "expand" in hooks) {
        value = hooks.expand(value);
        delete props[name];
        for (index in value) {
          if (!(index in props)) {
            props[index] = value[index];
            specialEasing[index] = easing;
          }
        }
      } else {
        specialEasing[name] = easing;
      }
    }
  }
  function Animation(elem, properties, options) {
    var result,
        stopped,
        index = 0,
        length = animationPrefilters.length,
        deferred = jQuery.Deferred().always(function() {
          delete tick.elem;
        }),
        tick = function() {
          if (stopped) {
            return false;
          }
          var currentTime = fxNow || createFxNow(),
              remaining = Math.max(0, animation.startTime + animation.duration - currentTime),
              temp = remaining / animation.duration || 0,
              percent = 1 - temp,
              index = 0,
              length = animation.tweens.length;
          for (; index < length; index++) {
            animation.tweens[index].run(percent);
          }
          deferred.notifyWith(elem, [animation, percent, remaining]);
          if (percent < 1 && length) {
            return remaining;
          } else {
            deferred.resolveWith(elem, [animation]);
            return false;
          }
        },
        animation = deferred.promise({
          elem: elem,
          props: jQuery.extend({}, properties),
          opts: jQuery.extend(true, {specialEasing: {}}, options),
          originalProperties: properties,
          originalOptions: options,
          startTime: fxNow || createFxNow(),
          duration: options.duration,
          tweens: [],
          createTween: function(prop, end) {
            var tween = jQuery.Tween(elem, animation.opts, prop, end, animation.opts.specialEasing[prop] || animation.opts.easing);
            animation.tweens.push(tween);
            return tween;
          },
          stop: function(gotoEnd) {
            var index = 0,
                length = gotoEnd ? animation.tweens.length : 0;
            if (stopped) {
              return this;
            }
            stopped = true;
            for (; index < length; index++) {
              animation.tweens[index].run(1);
            }
            if (gotoEnd) {
              deferred.resolveWith(elem, [animation, gotoEnd]);
            } else {
              deferred.rejectWith(elem, [animation, gotoEnd]);
            }
            return this;
          }
        }),
        props = animation.props;
    propFilter(props, animation.opts.specialEasing);
    for (; index < length; index++) {
      result = animationPrefilters[index].call(animation, elem, props, animation.opts);
      if (result) {
        return result;
      }
    }
    jQuery.map(props, createTween, animation);
    if (jQuery.isFunction(animation.opts.start)) {
      animation.opts.start.call(elem, animation);
    }
    jQuery.fx.timer(jQuery.extend(tick, {
      elem: elem,
      anim: animation,
      queue: animation.opts.queue
    }));
    return animation.progress(animation.opts.progress).done(animation.opts.done, animation.opts.complete).fail(animation.opts.fail).always(animation.opts.always);
  }
  jQuery.Animation = jQuery.extend(Animation, {
    tweener: function(props, callback) {
      if (jQuery.isFunction(props)) {
        callback = props;
        props = ["*"];
      } else {
        props = props.split(" ");
      }
      var prop,
          index = 0,
          length = props.length;
      for (; index < length; index++) {
        prop = props[index];
        tweeners[prop] = tweeners[prop] || [];
        tweeners[prop].unshift(callback);
      }
    },
    prefilter: function(callback, prepend) {
      if (prepend) {
        animationPrefilters.unshift(callback);
      } else {
        animationPrefilters.push(callback);
      }
    }
  });
  jQuery.speed = function(speed, easing, fn) {
    var opt = speed && typeof speed === "object" ? jQuery.extend({}, speed) : {
      complete: fn || !fn && easing || jQuery.isFunction(speed) && speed,
      duration: speed,
      easing: fn && easing || easing && !jQuery.isFunction(easing) && easing
    };
    opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration : opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[opt.duration] : jQuery.fx.speeds._default;
    if (opt.queue == null || opt.queue === true) {
      opt.queue = "fx";
    }
    opt.old = opt.complete;
    opt.complete = function() {
      if (jQuery.isFunction(opt.old)) {
        opt.old.call(this);
      }
      if (opt.queue) {
        jQuery.dequeue(this, opt.queue);
      }
    };
    return opt;
  };
  jQuery.fn.extend({
    fadeTo: function(speed, to, easing, callback) {
      return this.filter(isHidden).css("opacity", 0).show().end().animate({opacity: to}, speed, easing, callback);
    },
    animate: function(prop, speed, easing, callback) {
      var empty = jQuery.isEmptyObject(prop),
          optall = jQuery.speed(speed, easing, callback),
          doAnimation = function() {
            var anim = Animation(this, jQuery.extend({}, prop), optall);
            if (empty || data_priv.get(this, "finish")) {
              anim.stop(true);
            }
          };
      doAnimation.finish = doAnimation;
      return empty || optall.queue === false ? this.each(doAnimation) : this.queue(optall.queue, doAnimation);
    },
    stop: function(type, clearQueue, gotoEnd) {
      var stopQueue = function(hooks) {
        var stop = hooks.stop;
        delete hooks.stop;
        stop(gotoEnd);
      };
      if (typeof type !== "string") {
        gotoEnd = clearQueue;
        clearQueue = type;
        type = undefined;
      }
      if (clearQueue && type !== false) {
        this.queue(type || "fx", []);
      }
      return this.each(function() {
        var dequeue = true,
            index = type != null && type + "queueHooks",
            timers = jQuery.timers,
            data = data_priv.get(this);
        if (index) {
          if (data[index] && data[index].stop) {
            stopQueue(data[index]);
          }
        } else {
          for (index in data) {
            if (data[index] && data[index].stop && rrun.test(index)) {
              stopQueue(data[index]);
            }
          }
        }
        for (index = timers.length; index--; ) {
          if (timers[index].elem === this && (type == null || timers[index].queue === type)) {
            timers[index].anim.stop(gotoEnd);
            dequeue = false;
            timers.splice(index, 1);
          }
        }
        if (dequeue || !gotoEnd) {
          jQuery.dequeue(this, type);
        }
      });
    },
    finish: function(type) {
      if (type !== false) {
        type = type || "fx";
      }
      return this.each(function() {
        var index,
            data = data_priv.get(this),
            queue = data[type + "queue"],
            hooks = data[type + "queueHooks"],
            timers = jQuery.timers,
            length = queue ? queue.length : 0;
        data.finish = true;
        jQuery.queue(this, type, []);
        if (hooks && hooks.stop) {
          hooks.stop.call(this, true);
        }
        for (index = timers.length; index--; ) {
          if (timers[index].elem === this && timers[index].queue === type) {
            timers[index].anim.stop(true);
            timers.splice(index, 1);
          }
        }
        for (index = 0; index < length; index++) {
          if (queue[index] && queue[index].finish) {
            queue[index].finish.call(this);
          }
        }
        delete data.finish;
      });
    }
  });
  jQuery.each(["toggle", "show", "hide"], function(i, name) {
    var cssFn = jQuery.fn[name];
    jQuery.fn[name] = function(speed, easing, callback) {
      return speed == null || typeof speed === "boolean" ? cssFn.apply(this, arguments) : this.animate(genFx(name, true), speed, easing, callback);
    };
  });
  jQuery.each({
    slideDown: genFx("show"),
    slideUp: genFx("hide"),
    slideToggle: genFx("toggle"),
    fadeIn: {opacity: "show"},
    fadeOut: {opacity: "hide"},
    fadeToggle: {opacity: "toggle"}
  }, function(name, props) {
    jQuery.fn[name] = function(speed, easing, callback) {
      return this.animate(props, speed, easing, callback);
    };
  });
  jQuery.timers = [];
  jQuery.fx.tick = function() {
    var timer,
        i = 0,
        timers = jQuery.timers;
    fxNow = jQuery.now();
    for (; i < timers.length; i++) {
      timer = timers[i];
      if (!timer() && timers[i] === timer) {
        timers.splice(i--, 1);
      }
    }
    if (!timers.length) {
      jQuery.fx.stop();
    }
    fxNow = undefined;
  };
  jQuery.fx.timer = function(timer) {
    jQuery.timers.push(timer);
    if (timer()) {
      jQuery.fx.start();
    } else {
      jQuery.timers.pop();
    }
  };
  jQuery.fx.interval = 13;
  jQuery.fx.start = function() {
    if (!timerId) {
      timerId = setInterval(jQuery.fx.tick, jQuery.fx.interval);
    }
  };
  jQuery.fx.stop = function() {
    clearInterval(timerId);
    timerId = null;
  };
  jQuery.fx.speeds = {
    slow: 600,
    fast: 200,
    _default: 400
  };
  jQuery.fn.delay = function(time, type) {
    time = jQuery.fx ? jQuery.fx.speeds[time] || time : time;
    type = type || "fx";
    return this.queue(type, function(next, hooks) {
      var timeout = setTimeout(next, time);
      hooks.stop = function() {
        clearTimeout(timeout);
      };
    });
  };
  (function() {
    var input = document.createElement("input"),
        select = document.createElement("select"),
        opt = select.appendChild(document.createElement("option"));
    input.type = "checkbox";
    support.checkOn = input.value !== "";
    support.optSelected = opt.selected;
    select.disabled = true;
    support.optDisabled = !opt.disabled;
    input = document.createElement("input");
    input.value = "t";
    input.type = "radio";
    support.radioValue = input.value === "t";
  })();
  var nodeHook,
      boolHook,
      attrHandle = jQuery.expr.attrHandle;
  jQuery.fn.extend({
    attr: function(name, value) {
      return access(this, jQuery.attr, name, value, arguments.length > 1);
    },
    removeAttr: function(name) {
      return this.each(function() {
        jQuery.removeAttr(this, name);
      });
    }
  });
  jQuery.extend({
    attr: function(elem, name, value) {
      var hooks,
          ret,
          nType = elem.nodeType;
      if (!elem || nType === 3 || nType === 8 || nType === 2) {
        return ;
      }
      if (typeof elem.getAttribute === strundefined) {
        return jQuery.prop(elem, name, value);
      }
      if (nType !== 1 || !jQuery.isXMLDoc(elem)) {
        name = name.toLowerCase();
        hooks = jQuery.attrHooks[name] || (jQuery.expr.match.bool.test(name) ? boolHook : nodeHook);
      }
      if (value !== undefined) {
        if (value === null) {
          jQuery.removeAttr(elem, name);
        } else if (hooks && "set" in hooks && (ret = hooks.set(elem, value, name)) !== undefined) {
          return ret;
        } else {
          elem.setAttribute(name, value + "");
          return value;
        }
      } else if (hooks && "get" in hooks && (ret = hooks.get(elem, name)) !== null) {
        return ret;
      } else {
        ret = jQuery.find.attr(elem, name);
        return ret == null ? undefined : ret;
      }
    },
    removeAttr: function(elem, value) {
      var name,
          propName,
          i = 0,
          attrNames = value && value.match(rnotwhite);
      if (attrNames && elem.nodeType === 1) {
        while ((name = attrNames[i++])) {
          propName = jQuery.propFix[name] || name;
          if (jQuery.expr.match.bool.test(name)) {
            elem[propName] = false;
          }
          elem.removeAttribute(name);
        }
      }
    },
    attrHooks: {type: {set: function(elem, value) {
          if (!support.radioValue && value === "radio" && jQuery.nodeName(elem, "input")) {
            var val = elem.value;
            elem.setAttribute("type", value);
            if (val) {
              elem.value = val;
            }
            return value;
          }
        }}}
  });
  boolHook = {set: function(elem, value, name) {
      if (value === false) {
        jQuery.removeAttr(elem, name);
      } else {
        elem.setAttribute(name, name);
      }
      return name;
    }};
  jQuery.each(jQuery.expr.match.bool.source.match(/\w+/g), function(i, name) {
    var getter = attrHandle[name] || jQuery.find.attr;
    attrHandle[name] = function(elem, name, isXML) {
      var ret,
          handle;
      if (!isXML) {
        handle = attrHandle[name];
        attrHandle[name] = ret;
        ret = getter(elem, name, isXML) != null ? name.toLowerCase() : null;
        attrHandle[name] = handle;
      }
      return ret;
    };
  });
  var rfocusable = /^(?:input|select|textarea|button)$/i;
  jQuery.fn.extend({
    prop: function(name, value) {
      return access(this, jQuery.prop, name, value, arguments.length > 1);
    },
    removeProp: function(name) {
      return this.each(function() {
        delete this[jQuery.propFix[name] || name];
      });
    }
  });
  jQuery.extend({
    propFix: {
      "for": "htmlFor",
      "class": "className"
    },
    prop: function(elem, name, value) {
      var ret,
          hooks,
          notxml,
          nType = elem.nodeType;
      if (!elem || nType === 3 || nType === 8 || nType === 2) {
        return ;
      }
      notxml = nType !== 1 || !jQuery.isXMLDoc(elem);
      if (notxml) {
        name = jQuery.propFix[name] || name;
        hooks = jQuery.propHooks[name];
      }
      if (value !== undefined) {
        return hooks && "set" in hooks && (ret = hooks.set(elem, value, name)) !== undefined ? ret : (elem[name] = value);
      } else {
        return hooks && "get" in hooks && (ret = hooks.get(elem, name)) !== null ? ret : elem[name];
      }
    },
    propHooks: {tabIndex: {get: function(elem) {
          return elem.hasAttribute("tabindex") || rfocusable.test(elem.nodeName) || elem.href ? elem.tabIndex : -1;
        }}}
  });
  if (!support.optSelected) {
    jQuery.propHooks.selected = {get: function(elem) {
        var parent = elem.parentNode;
        if (parent && parent.parentNode) {
          parent.parentNode.selectedIndex;
        }
        return null;
      }};
  }
  jQuery.each(["tabIndex", "readOnly", "maxLength", "cellSpacing", "cellPadding", "rowSpan", "colSpan", "useMap", "frameBorder", "contentEditable"], function() {
    jQuery.propFix[this.toLowerCase()] = this;
  });
  var rclass = /[\t\r\n\f]/g;
  jQuery.fn.extend({
    addClass: function(value) {
      var classes,
          elem,
          cur,
          clazz,
          j,
          finalValue,
          proceed = typeof value === "string" && value,
          i = 0,
          len = this.length;
      if (jQuery.isFunction(value)) {
        return this.each(function(j) {
          jQuery(this).addClass(value.call(this, j, this.className));
        });
      }
      if (proceed) {
        classes = (value || "").match(rnotwhite) || [];
        for (; i < len; i++) {
          elem = this[i];
          cur = elem.nodeType === 1 && (elem.className ? (" " + elem.className + " ").replace(rclass, " ") : " ");
          if (cur) {
            j = 0;
            while ((clazz = classes[j++])) {
              if (cur.indexOf(" " + clazz + " ") < 0) {
                cur += clazz + " ";
              }
            }
            finalValue = jQuery.trim(cur);
            if (elem.className !== finalValue) {
              elem.className = finalValue;
            }
          }
        }
      }
      return this;
    },
    removeClass: function(value) {
      var classes,
          elem,
          cur,
          clazz,
          j,
          finalValue,
          proceed = arguments.length === 0 || typeof value === "string" && value,
          i = 0,
          len = this.length;
      if (jQuery.isFunction(value)) {
        return this.each(function(j) {
          jQuery(this).removeClass(value.call(this, j, this.className));
        });
      }
      if (proceed) {
        classes = (value || "").match(rnotwhite) || [];
        for (; i < len; i++) {
          elem = this[i];
          cur = elem.nodeType === 1 && (elem.className ? (" " + elem.className + " ").replace(rclass, " ") : "");
          if (cur) {
            j = 0;
            while ((clazz = classes[j++])) {
              while (cur.indexOf(" " + clazz + " ") >= 0) {
                cur = cur.replace(" " + clazz + " ", " ");
              }
            }
            finalValue = value ? jQuery.trim(cur) : "";
            if (elem.className !== finalValue) {
              elem.className = finalValue;
            }
          }
        }
      }
      return this;
    },
    toggleClass: function(value, stateVal) {
      var type = typeof value;
      if (typeof stateVal === "boolean" && type === "string") {
        return stateVal ? this.addClass(value) : this.removeClass(value);
      }
      if (jQuery.isFunction(value)) {
        return this.each(function(i) {
          jQuery(this).toggleClass(value.call(this, i, this.className, stateVal), stateVal);
        });
      }
      return this.each(function() {
        if (type === "string") {
          var className,
              i = 0,
              self = jQuery(this),
              classNames = value.match(rnotwhite) || [];
          while ((className = classNames[i++])) {
            if (self.hasClass(className)) {
              self.removeClass(className);
            } else {
              self.addClass(className);
            }
          }
        } else if (type === strundefined || type === "boolean") {
          if (this.className) {
            data_priv.set(this, "__className__", this.className);
          }
          this.className = this.className || value === false ? "" : data_priv.get(this, "__className__") || "";
        }
      });
    },
    hasClass: function(selector) {
      var className = " " + selector + " ",
          i = 0,
          l = this.length;
      for (; i < l; i++) {
        if (this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf(className) >= 0) {
          return true;
        }
      }
      return false;
    }
  });
  var rreturn = /\r/g;
  jQuery.fn.extend({val: function(value) {
      var hooks,
          ret,
          isFunction,
          elem = this[0];
      if (!arguments.length) {
        if (elem) {
          hooks = jQuery.valHooks[elem.type] || jQuery.valHooks[elem.nodeName.toLowerCase()];
          if (hooks && "get" in hooks && (ret = hooks.get(elem, "value")) !== undefined) {
            return ret;
          }
          ret = elem.value;
          return typeof ret === "string" ? ret.replace(rreturn, "") : ret == null ? "" : ret;
        }
        return ;
      }
      isFunction = jQuery.isFunction(value);
      return this.each(function(i) {
        var val;
        if (this.nodeType !== 1) {
          return ;
        }
        if (isFunction) {
          val = value.call(this, i, jQuery(this).val());
        } else {
          val = value;
        }
        if (val == null) {
          val = "";
        } else if (typeof val === "number") {
          val += "";
        } else if (jQuery.isArray(val)) {
          val = jQuery.map(val, function(value) {
            return value == null ? "" : value + "";
          });
        }
        hooks = jQuery.valHooks[this.type] || jQuery.valHooks[this.nodeName.toLowerCase()];
        if (!hooks || !("set" in hooks) || hooks.set(this, val, "value") === undefined) {
          this.value = val;
        }
      });
    }});
  jQuery.extend({valHooks: {
      option: {get: function(elem) {
          var val = jQuery.find.attr(elem, "value");
          return val != null ? val : jQuery.trim(jQuery.text(elem));
        }},
      select: {
        get: function(elem) {
          var value,
              option,
              options = elem.options,
              index = elem.selectedIndex,
              one = elem.type === "select-one" || index < 0,
              values = one ? null : [],
              max = one ? index + 1 : options.length,
              i = index < 0 ? max : one ? index : 0;
          for (; i < max; i++) {
            option = options[i];
            if ((option.selected || i === index) && (support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null) && (!option.parentNode.disabled || !jQuery.nodeName(option.parentNode, "optgroup"))) {
              value = jQuery(option).val();
              if (one) {
                return value;
              }
              values.push(value);
            }
          }
          return values;
        },
        set: function(elem, value) {
          var optionSet,
              option,
              options = elem.options,
              values = jQuery.makeArray(value),
              i = options.length;
          while (i--) {
            option = options[i];
            if ((option.selected = jQuery.inArray(option.value, values) >= 0)) {
              optionSet = true;
            }
          }
          if (!optionSet) {
            elem.selectedIndex = -1;
          }
          return values;
        }
      }
    }});
  jQuery.each(["radio", "checkbox"], function() {
    jQuery.valHooks[this] = {set: function(elem, value) {
        if (jQuery.isArray(value)) {
          return (elem.checked = jQuery.inArray(jQuery(elem).val(), value) >= 0);
        }
      }};
    if (!support.checkOn) {
      jQuery.valHooks[this].get = function(elem) {
        return elem.getAttribute("value") === null ? "on" : elem.value;
      };
    }
  });
  jQuery.each(("blur focus focusin focusout load resize scroll unload click dblclick " + "mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " + "change select submit keydown keypress keyup error contextmenu").split(" "), function(i, name) {
    jQuery.fn[name] = function(data, fn) {
      return arguments.length > 0 ? this.on(name, null, data, fn) : this.trigger(name);
    };
  });
  jQuery.fn.extend({
    hover: function(fnOver, fnOut) {
      return this.mouseenter(fnOver).mouseleave(fnOut || fnOver);
    },
    bind: function(types, data, fn) {
      return this.on(types, null, data, fn);
    },
    unbind: function(types, fn) {
      return this.off(types, null, fn);
    },
    delegate: function(selector, types, data, fn) {
      return this.on(types, selector, data, fn);
    },
    undelegate: function(selector, types, fn) {
      return arguments.length === 1 ? this.off(selector, "**") : this.off(types, selector || "**", fn);
    }
  });
  var nonce = jQuery.now();
  var rquery = (/\?/);
  jQuery.parseJSON = function(data) {
    return JSON.parse(data + "");
  };
  jQuery.parseXML = function(data) {
    var xml,
        tmp;
    if (!data || typeof data !== "string") {
      return null;
    }
    try {
      tmp = new DOMParser();
      xml = tmp.parseFromString(data, "text/xml");
    } catch (e) {
      xml = undefined;
    }
    if (!xml || xml.getElementsByTagName("parsererror").length) {
      jQuery.error("Invalid XML: " + data);
    }
    return xml;
  };
  var rhash = /#.*$/,
      rts = /([?&])_=[^&]*/,
      rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,
      rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
      rnoContent = /^(?:GET|HEAD)$/,
      rprotocol = /^\/\//,
      rurl = /^([\w.+-]+:)(?:\/\/(?:[^\/?#]*@|)([^\/?#:]*)(?::(\d+)|)|)/,
      prefilters = {},
      transports = {},
      allTypes = "*/".concat("*"),
      ajaxLocation = window.location.href,
      ajaxLocParts = rurl.exec(ajaxLocation.toLowerCase()) || [];
  function addToPrefiltersOrTransports(structure) {
    return function(dataTypeExpression, func) {
      if (typeof dataTypeExpression !== "string") {
        func = dataTypeExpression;
        dataTypeExpression = "*";
      }
      var dataType,
          i = 0,
          dataTypes = dataTypeExpression.toLowerCase().match(rnotwhite) || [];
      if (jQuery.isFunction(func)) {
        while ((dataType = dataTypes[i++])) {
          if (dataType[0] === "+") {
            dataType = dataType.slice(1) || "*";
            (structure[dataType] = structure[dataType] || []).unshift(func);
          } else {
            (structure[dataType] = structure[dataType] || []).push(func);
          }
        }
      }
    };
  }
  function inspectPrefiltersOrTransports(structure, options, originalOptions, jqXHR) {
    var inspected = {},
        seekingTransport = (structure === transports);
    function inspect(dataType) {
      var selected;
      inspected[dataType] = true;
      jQuery.each(structure[dataType] || [], function(_, prefilterOrFactory) {
        var dataTypeOrTransport = prefilterOrFactory(options, originalOptions, jqXHR);
        if (typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[dataTypeOrTransport]) {
          options.dataTypes.unshift(dataTypeOrTransport);
          inspect(dataTypeOrTransport);
          return false;
        } else if (seekingTransport) {
          return !(selected = dataTypeOrTransport);
        }
      });
      return selected;
    }
    return inspect(options.dataTypes[0]) || !inspected["*"] && inspect("*");
  }
  function ajaxExtend(target, src) {
    var key,
        deep,
        flatOptions = jQuery.ajaxSettings.flatOptions || {};
    for (key in src) {
      if (src[key] !== undefined) {
        (flatOptions[key] ? target : (deep || (deep = {})))[key] = src[key];
      }
    }
    if (deep) {
      jQuery.extend(true, target, deep);
    }
    return target;
  }
  function ajaxHandleResponses(s, jqXHR, responses) {
    var ct,
        type,
        finalDataType,
        firstDataType,
        contents = s.contents,
        dataTypes = s.dataTypes;
    while (dataTypes[0] === "*") {
      dataTypes.shift();
      if (ct === undefined) {
        ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
      }
    }
    if (ct) {
      for (type in contents) {
        if (contents[type] && contents[type].test(ct)) {
          dataTypes.unshift(type);
          break;
        }
      }
    }
    if (dataTypes[0] in responses) {
      finalDataType = dataTypes[0];
    } else {
      for (type in responses) {
        if (!dataTypes[0] || s.converters[type + " " + dataTypes[0]]) {
          finalDataType = type;
          break;
        }
        if (!firstDataType) {
          firstDataType = type;
        }
      }
      finalDataType = finalDataType || firstDataType;
    }
    if (finalDataType) {
      if (finalDataType !== dataTypes[0]) {
        dataTypes.unshift(finalDataType);
      }
      return responses[finalDataType];
    }
  }
  function ajaxConvert(s, response, jqXHR, isSuccess) {
    var conv2,
        current,
        conv,
        tmp,
        prev,
        converters = {},
        dataTypes = s.dataTypes.slice();
    if (dataTypes[1]) {
      for (conv in s.converters) {
        converters[conv.toLowerCase()] = s.converters[conv];
      }
    }
    current = dataTypes.shift();
    while (current) {
      if (s.responseFields[current]) {
        jqXHR[s.responseFields[current]] = response;
      }
      if (!prev && isSuccess && s.dataFilter) {
        response = s.dataFilter(response, s.dataType);
      }
      prev = current;
      current = dataTypes.shift();
      if (current) {
        if (current === "*") {
          current = prev;
        } else if (prev !== "*" && prev !== current) {
          conv = converters[prev + " " + current] || converters["* " + current];
          if (!conv) {
            for (conv2 in converters) {
              tmp = conv2.split(" ");
              if (tmp[1] === current) {
                conv = converters[prev + " " + tmp[0]] || converters["* " + tmp[0]];
                if (conv) {
                  if (conv === true) {
                    conv = converters[conv2];
                  } else if (converters[conv2] !== true) {
                    current = tmp[0];
                    dataTypes.unshift(tmp[1]);
                  }
                  break;
                }
              }
            }
          }
          if (conv !== true) {
            if (conv && s["throws"]) {
              response = conv(response);
            } else {
              try {
                response = conv(response);
              } catch (e) {
                return {
                  state: "parsererror",
                  error: conv ? e : "No conversion from " + prev + " to " + current
                };
              }
            }
          }
        }
      }
    }
    return {
      state: "success",
      data: response
    };
  }
  jQuery.extend({
    active: 0,
    lastModified: {},
    etag: {},
    ajaxSettings: {
      url: ajaxLocation,
      type: "GET",
      isLocal: rlocalProtocol.test(ajaxLocParts[1]),
      global: true,
      processData: true,
      async: true,
      contentType: "application/x-www-form-urlencoded; charset=UTF-8",
      accepts: {
        "*": allTypes,
        text: "text/plain",
        html: "text/html",
        xml: "application/xml, text/xml",
        json: "application/json, text/javascript"
      },
      contents: {
        xml: /xml/,
        html: /html/,
        json: /json/
      },
      responseFields: {
        xml: "responseXML",
        text: "responseText",
        json: "responseJSON"
      },
      converters: {
        "* text": String,
        "text html": true,
        "text json": jQuery.parseJSON,
        "text xml": jQuery.parseXML
      },
      flatOptions: {
        url: true,
        context: true
      }
    },
    ajaxSetup: function(target, settings) {
      return settings ? ajaxExtend(ajaxExtend(target, jQuery.ajaxSettings), settings) : ajaxExtend(jQuery.ajaxSettings, target);
    },
    ajaxPrefilter: addToPrefiltersOrTransports(prefilters),
    ajaxTransport: addToPrefiltersOrTransports(transports),
    ajax: function(url, options) {
      if (typeof url === "object") {
        options = url;
        url = undefined;
      }
      options = options || {};
      var transport,
          cacheURL,
          responseHeadersString,
          responseHeaders,
          timeoutTimer,
          parts,
          fireGlobals,
          i,
          s = jQuery.ajaxSetup({}, options),
          callbackContext = s.context || s,
          globalEventContext = s.context && (callbackContext.nodeType || callbackContext.jquery) ? jQuery(callbackContext) : jQuery.event,
          deferred = jQuery.Deferred(),
          completeDeferred = jQuery.Callbacks("once memory"),
          statusCode = s.statusCode || {},
          requestHeaders = {},
          requestHeadersNames = {},
          state = 0,
          strAbort = "canceled",
          jqXHR = {
            readyState: 0,
            getResponseHeader: function(key) {
              var match;
              if (state === 2) {
                if (!responseHeaders) {
                  responseHeaders = {};
                  while ((match = rheaders.exec(responseHeadersString))) {
                    responseHeaders[match[1].toLowerCase()] = match[2];
                  }
                }
                match = responseHeaders[key.toLowerCase()];
              }
              return match == null ? null : match;
            },
            getAllResponseHeaders: function() {
              return state === 2 ? responseHeadersString : null;
            },
            setRequestHeader: function(name, value) {
              var lname = name.toLowerCase();
              if (!state) {
                name = requestHeadersNames[lname] = requestHeadersNames[lname] || name;
                requestHeaders[name] = value;
              }
              return this;
            },
            overrideMimeType: function(type) {
              if (!state) {
                s.mimeType = type;
              }
              return this;
            },
            statusCode: function(map) {
              var code;
              if (map) {
                if (state < 2) {
                  for (code in map) {
                    statusCode[code] = [statusCode[code], map[code]];
                  }
                } else {
                  jqXHR.always(map[jqXHR.status]);
                }
              }
              return this;
            },
            abort: function(statusText) {
              var finalText = statusText || strAbort;
              if (transport) {
                transport.abort(finalText);
              }
              done(0, finalText);
              return this;
            }
          };
      deferred.promise(jqXHR).complete = completeDeferred.add;
      jqXHR.success = jqXHR.done;
      jqXHR.error = jqXHR.fail;
      s.url = ((url || s.url || ajaxLocation) + "").replace(rhash, "").replace(rprotocol, ajaxLocParts[1] + "//");
      s.type = options.method || options.type || s.method || s.type;
      s.dataTypes = jQuery.trim(s.dataType || "*").toLowerCase().match(rnotwhite) || [""];
      if (s.crossDomain == null) {
        parts = rurl.exec(s.url.toLowerCase());
        s.crossDomain = !!(parts && (parts[1] !== ajaxLocParts[1] || parts[2] !== ajaxLocParts[2] || (parts[3] || (parts[1] === "http:" ? "80" : "443")) !== (ajaxLocParts[3] || (ajaxLocParts[1] === "http:" ? "80" : "443"))));
      }
      if (s.data && s.processData && typeof s.data !== "string") {
        s.data = jQuery.param(s.data, s.traditional);
      }
      inspectPrefiltersOrTransports(prefilters, s, options, jqXHR);
      if (state === 2) {
        return jqXHR;
      }
      fireGlobals = jQuery.event && s.global;
      if (fireGlobals && jQuery.active++ === 0) {
        jQuery.event.trigger("ajaxStart");
      }
      s.type = s.type.toUpperCase();
      s.hasContent = !rnoContent.test(s.type);
      cacheURL = s.url;
      if (!s.hasContent) {
        if (s.data) {
          cacheURL = (s.url += (rquery.test(cacheURL) ? "&" : "?") + s.data);
          delete s.data;
        }
        if (s.cache === false) {
          s.url = rts.test(cacheURL) ? cacheURL.replace(rts, "$1_=" + nonce++) : cacheURL + (rquery.test(cacheURL) ? "&" : "?") + "_=" + nonce++;
        }
      }
      if (s.ifModified) {
        if (jQuery.lastModified[cacheURL]) {
          jqXHR.setRequestHeader("If-Modified-Since", jQuery.lastModified[cacheURL]);
        }
        if (jQuery.etag[cacheURL]) {
          jqXHR.setRequestHeader("If-None-Match", jQuery.etag[cacheURL]);
        }
      }
      if (s.data && s.hasContent && s.contentType !== false || options.contentType) {
        jqXHR.setRequestHeader("Content-Type", s.contentType);
      }
      jqXHR.setRequestHeader("Accept", s.dataTypes[0] && s.accepts[s.dataTypes[0]] ? s.accepts[s.dataTypes[0]] + (s.dataTypes[0] !== "*" ? ", " + allTypes + "; q=0.01" : "") : s.accepts["*"]);
      for (i in s.headers) {
        jqXHR.setRequestHeader(i, s.headers[i]);
      }
      if (s.beforeSend && (s.beforeSend.call(callbackContext, jqXHR, s) === false || state === 2)) {
        return jqXHR.abort();
      }
      strAbort = "abort";
      for (i in {
        success: 1,
        error: 1,
        complete: 1
      }) {
        jqXHR[i](s[i]);
      }
      transport = inspectPrefiltersOrTransports(transports, s, options, jqXHR);
      if (!transport) {
        done(-1, "No Transport");
      } else {
        jqXHR.readyState = 1;
        if (fireGlobals) {
          globalEventContext.trigger("ajaxSend", [jqXHR, s]);
        }
        if (s.async && s.timeout > 0) {
          timeoutTimer = setTimeout(function() {
            jqXHR.abort("timeout");
          }, s.timeout);
        }
        try {
          state = 1;
          transport.send(requestHeaders, done);
        } catch (e) {
          if (state < 2) {
            done(-1, e);
          } else {
            throw e;
          }
        }
      }
      function done(status, nativeStatusText, responses, headers) {
        var isSuccess,
            success,
            error,
            response,
            modified,
            statusText = nativeStatusText;
        if (state === 2) {
          return ;
        }
        state = 2;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        transport = undefined;
        responseHeadersString = headers || "";
        jqXHR.readyState = status > 0 ? 4 : 0;
        isSuccess = status >= 200 && status < 300 || status === 304;
        if (responses) {
          response = ajaxHandleResponses(s, jqXHR, responses);
        }
        response = ajaxConvert(s, response, jqXHR, isSuccess);
        if (isSuccess) {
          if (s.ifModified) {
            modified = jqXHR.getResponseHeader("Last-Modified");
            if (modified) {
              jQuery.lastModified[cacheURL] = modified;
            }
            modified = jqXHR.getResponseHeader("etag");
            if (modified) {
              jQuery.etag[cacheURL] = modified;
            }
          }
          if (status === 204 || s.type === "HEAD") {
            statusText = "nocontent";
          } else if (status === 304) {
            statusText = "notmodified";
          } else {
            statusText = response.state;
            success = response.data;
            error = response.error;
            isSuccess = !error;
          }
        } else {
          error = statusText;
          if (status || !statusText) {
            statusText = "error";
            if (status < 0) {
              status = 0;
            }
          }
        }
        jqXHR.status = status;
        jqXHR.statusText = (nativeStatusText || statusText) + "";
        if (isSuccess) {
          deferred.resolveWith(callbackContext, [success, statusText, jqXHR]);
        } else {
          deferred.rejectWith(callbackContext, [jqXHR, statusText, error]);
        }
        jqXHR.statusCode(statusCode);
        statusCode = undefined;
        if (fireGlobals) {
          globalEventContext.trigger(isSuccess ? "ajaxSuccess" : "ajaxError", [jqXHR, s, isSuccess ? success : error]);
        }
        completeDeferred.fireWith(callbackContext, [jqXHR, statusText]);
        if (fireGlobals) {
          globalEventContext.trigger("ajaxComplete", [jqXHR, s]);
          if (!(--jQuery.active)) {
            jQuery.event.trigger("ajaxStop");
          }
        }
      }
      return jqXHR;
    },
    getJSON: function(url, data, callback) {
      return jQuery.get(url, data, callback, "json");
    },
    getScript: function(url, callback) {
      return jQuery.get(url, undefined, callback, "script");
    }
  });
  jQuery.each(["get", "post"], function(i, method) {
    jQuery[method] = function(url, data, callback, type) {
      if (jQuery.isFunction(data)) {
        type = type || callback;
        callback = data;
        data = undefined;
      }
      return jQuery.ajax({
        url: url,
        type: method,
        dataType: type,
        data: data,
        success: callback
      });
    };
  });
  jQuery._evalUrl = function(url) {
    return jQuery.ajax({
      url: url,
      type: "GET",
      dataType: "script",
      async: false,
      global: false,
      "throws": true
    });
  };
  jQuery.fn.extend({
    wrapAll: function(html) {
      var wrap;
      if (jQuery.isFunction(html)) {
        return this.each(function(i) {
          jQuery(this).wrapAll(html.call(this, i));
        });
      }
      if (this[0]) {
        wrap = jQuery(html, this[0].ownerDocument).eq(0).clone(true);
        if (this[0].parentNode) {
          wrap.insertBefore(this[0]);
        }
        wrap.map(function() {
          var elem = this;
          while (elem.firstElementChild) {
            elem = elem.firstElementChild;
          }
          return elem;
        }).append(this);
      }
      return this;
    },
    wrapInner: function(html) {
      if (jQuery.isFunction(html)) {
        return this.each(function(i) {
          jQuery(this).wrapInner(html.call(this, i));
        });
      }
      return this.each(function() {
        var self = jQuery(this),
            contents = self.contents();
        if (contents.length) {
          contents.wrapAll(html);
        } else {
          self.append(html);
        }
      });
    },
    wrap: function(html) {
      var isFunction = jQuery.isFunction(html);
      return this.each(function(i) {
        jQuery(this).wrapAll(isFunction ? html.call(this, i) : html);
      });
    },
    unwrap: function() {
      return this.parent().each(function() {
        if (!jQuery.nodeName(this, "body")) {
          jQuery(this).replaceWith(this.childNodes);
        }
      }).end();
    }
  });
  jQuery.expr.filters.hidden = function(elem) {
    return elem.offsetWidth <= 0 && elem.offsetHeight <= 0;
  };
  jQuery.expr.filters.visible = function(elem) {
    return !jQuery.expr.filters.hidden(elem);
  };
  var r20 = /%20/g,
      rbracket = /\[\]$/,
      rCRLF = /\r?\n/g,
      rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
      rsubmittable = /^(?:input|select|textarea|keygen)/i;
  function buildParams(prefix, obj, traditional, add) {
    var name;
    if (jQuery.isArray(obj)) {
      jQuery.each(obj, function(i, v) {
        if (traditional || rbracket.test(prefix)) {
          add(prefix, v);
        } else {
          buildParams(prefix + "[" + (typeof v === "object" ? i : "") + "]", v, traditional, add);
        }
      });
    } else if (!traditional && jQuery.type(obj) === "object") {
      for (name in obj) {
        buildParams(prefix + "[" + name + "]", obj[name], traditional, add);
      }
    } else {
      add(prefix, obj);
    }
  }
  jQuery.param = function(a, traditional) {
    var prefix,
        s = [],
        add = function(key, value) {
          value = jQuery.isFunction(value) ? value() : (value == null ? "" : value);
          s[s.length] = encodeURIComponent(key) + "=" + encodeURIComponent(value);
        };
    if (traditional === undefined) {
      traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
    }
    if (jQuery.isArray(a) || (a.jquery && !jQuery.isPlainObject(a))) {
      jQuery.each(a, function() {
        add(this.name, this.value);
      });
    } else {
      for (prefix in a) {
        buildParams(prefix, a[prefix], traditional, add);
      }
    }
    return s.join("&").replace(r20, "+");
  };
  jQuery.fn.extend({
    serialize: function() {
      return jQuery.param(this.serializeArray());
    },
    serializeArray: function() {
      return this.map(function() {
        var elements = jQuery.prop(this, "elements");
        return elements ? jQuery.makeArray(elements) : this;
      }).filter(function() {
        var type = this.type;
        return this.name && !jQuery(this).is(":disabled") && rsubmittable.test(this.nodeName) && !rsubmitterTypes.test(type) && (this.checked || !rcheckableType.test(type));
      }).map(function(i, elem) {
        var val = jQuery(this).val();
        return val == null ? null : jQuery.isArray(val) ? jQuery.map(val, function(val) {
          return {
            name: elem.name,
            value: val.replace(rCRLF, "\r\n")
          };
        }) : {
          name: elem.name,
          value: val.replace(rCRLF, "\r\n")
        };
      }).get();
    }
  });
  jQuery.ajaxSettings.xhr = function() {
    try {
      return new XMLHttpRequest();
    } catch (e) {}
  };
  var xhrId = 0,
      xhrCallbacks = {},
      xhrSuccessStatus = {
        0: 200,
        1223: 204
      },
      xhrSupported = jQuery.ajaxSettings.xhr();
  if (window.attachEvent) {
    window.attachEvent("onunload", function() {
      for (var key in xhrCallbacks) {
        xhrCallbacks[key]();
      }
    });
  }
  support.cors = !!xhrSupported && ("withCredentials" in xhrSupported);
  support.ajax = xhrSupported = !!xhrSupported;
  jQuery.ajaxTransport(function(options) {
    var callback;
    if (support.cors || xhrSupported && !options.crossDomain) {
      return {
        send: function(headers, complete) {
          var i,
              xhr = options.xhr(),
              id = ++xhrId;
          xhr.open(options.type, options.url, options.async, options.username, options.password);
          if (options.xhrFields) {
            for (i in options.xhrFields) {
              xhr[i] = options.xhrFields[i];
            }
          }
          if (options.mimeType && xhr.overrideMimeType) {
            xhr.overrideMimeType(options.mimeType);
          }
          if (!options.crossDomain && !headers["X-Requested-With"]) {
            headers["X-Requested-With"] = "XMLHttpRequest";
          }
          for (i in headers) {
            xhr.setRequestHeader(i, headers[i]);
          }
          callback = function(type) {
            return function() {
              if (callback) {
                delete xhrCallbacks[id];
                callback = xhr.onload = xhr.onerror = null;
                if (type === "abort") {
                  xhr.abort();
                } else if (type === "error") {
                  complete(xhr.status, xhr.statusText);
                } else {
                  complete(xhrSuccessStatus[xhr.status] || xhr.status, xhr.statusText, typeof xhr.responseText === "string" ? {text: xhr.responseText} : undefined, xhr.getAllResponseHeaders());
                }
              }
            };
          };
          xhr.onload = callback();
          xhr.onerror = callback("error");
          callback = xhrCallbacks[id] = callback("abort");
          try {
            xhr.send(options.hasContent && options.data || null);
          } catch (e) {
            if (callback) {
              throw e;
            }
          }
        },
        abort: function() {
          if (callback) {
            callback();
          }
        }
      };
    }
  });
  jQuery.ajaxSetup({
    accepts: {script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},
    contents: {script: /(?:java|ecma)script/},
    converters: {"text script": function(text) {
        jQuery.globalEval(text);
        return text;
      }}
  });
  jQuery.ajaxPrefilter("script", function(s) {
    if (s.cache === undefined) {
      s.cache = false;
    }
    if (s.crossDomain) {
      s.type = "GET";
    }
  });
  jQuery.ajaxTransport("script", function(s) {
    if (s.crossDomain) {
      var script,
          callback;
      return {
        send: function(_, complete) {
          script = jQuery("<script>").prop({
            async: true,
            charset: s.scriptCharset,
            src: s.url
          }).on("load error", callback = function(evt) {
            script.remove();
            callback = null;
            if (evt) {
              complete(evt.type === "error" ? 404 : 200, evt.type);
            }
          });
          document.head.appendChild(script[0]);
        },
        abort: function() {
          if (callback) {
            callback();
          }
        }
      };
    }
  });
  var oldCallbacks = [],
      rjsonp = /(=)\?(?=&|$)|\?\?/;
  jQuery.ajaxSetup({
    jsonp: "callback",
    jsonpCallback: function() {
      var callback = oldCallbacks.pop() || (jQuery.expando + "_" + (nonce++));
      this[callback] = true;
      return callback;
    }
  });
  jQuery.ajaxPrefilter("json jsonp", function(s, originalSettings, jqXHR) {
    var callbackName,
        overwritten,
        responseContainer,
        jsonProp = s.jsonp !== false && (rjsonp.test(s.url) ? "url" : typeof s.data === "string" && !(s.contentType || "").indexOf("application/x-www-form-urlencoded") && rjsonp.test(s.data) && "data");
    if (jsonProp || s.dataTypes[0] === "jsonp") {
      callbackName = s.jsonpCallback = jQuery.isFunction(s.jsonpCallback) ? s.jsonpCallback() : s.jsonpCallback;
      if (jsonProp) {
        s[jsonProp] = s[jsonProp].replace(rjsonp, "$1" + callbackName);
      } else if (s.jsonp !== false) {
        s.url += (rquery.test(s.url) ? "&" : "?") + s.jsonp + "=" + callbackName;
      }
      s.converters["script json"] = function() {
        if (!responseContainer) {
          jQuery.error(callbackName + " was not called");
        }
        return responseContainer[0];
      };
      s.dataTypes[0] = "json";
      overwritten = window[callbackName];
      window[callbackName] = function() {
        responseContainer = arguments;
      };
      jqXHR.always(function() {
        window[callbackName] = overwritten;
        if (s[callbackName]) {
          s.jsonpCallback = originalSettings.jsonpCallback;
          oldCallbacks.push(callbackName);
        }
        if (responseContainer && jQuery.isFunction(overwritten)) {
          overwritten(responseContainer[0]);
        }
        responseContainer = overwritten = undefined;
      });
      return "script";
    }
  });
  jQuery.parseHTML = function(data, context, keepScripts) {
    if (!data || typeof data !== "string") {
      return null;
    }
    if (typeof context === "boolean") {
      keepScripts = context;
      context = false;
    }
    context = context || document;
    var parsed = rsingleTag.exec(data),
        scripts = !keepScripts && [];
    if (parsed) {
      return [context.createElement(parsed[1])];
    }
    parsed = jQuery.buildFragment([data], context, scripts);
    if (scripts && scripts.length) {
      jQuery(scripts).remove();
    }
    return jQuery.merge([], parsed.childNodes);
  };
  var _load = jQuery.fn.load;
  jQuery.fn.load = function(url, params, callback) {
    if (typeof url !== "string" && _load) {
      return _load.apply(this, arguments);
    }
    var selector,
        type,
        response,
        self = this,
        off = url.indexOf(" ");
    if (off >= 0) {
      selector = jQuery.trim(url.slice(off));
      url = url.slice(0, off);
    }
    if (jQuery.isFunction(params)) {
      callback = params;
      params = undefined;
    } else if (params && typeof params === "object") {
      type = "POST";
    }
    if (self.length > 0) {
      jQuery.ajax({
        url: url,
        type: type,
        dataType: "html",
        data: params
      }).done(function(responseText) {
        response = arguments;
        self.html(selector ? jQuery("<div>").append(jQuery.parseHTML(responseText)).find(selector) : responseText);
      }).complete(callback && function(jqXHR, status) {
        self.each(callback, response || [jqXHR.responseText, status, jqXHR]);
      });
    }
    return this;
  };
  jQuery.each(["ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend"], function(i, type) {
    jQuery.fn[type] = function(fn) {
      return this.on(type, fn);
    };
  });
  jQuery.expr.filters.animated = function(elem) {
    return jQuery.grep(jQuery.timers, function(fn) {
      return elem === fn.elem;
    }).length;
  };
  var docElem = window.document.documentElement;
  function getWindow(elem) {
    return jQuery.isWindow(elem) ? elem : elem.nodeType === 9 && elem.defaultView;
  }
  jQuery.offset = {setOffset: function(elem, options, i) {
      var curPosition,
          curLeft,
          curCSSTop,
          curTop,
          curOffset,
          curCSSLeft,
          calculatePosition,
          position = jQuery.css(elem, "position"),
          curElem = jQuery(elem),
          props = {};
      if (position === "static") {
        elem.style.position = "relative";
      }
      curOffset = curElem.offset();
      curCSSTop = jQuery.css(elem, "top");
      curCSSLeft = jQuery.css(elem, "left");
      calculatePosition = (position === "absolute" || position === "fixed") && (curCSSTop + curCSSLeft).indexOf("auto") > -1;
      if (calculatePosition) {
        curPosition = curElem.position();
        curTop = curPosition.top;
        curLeft = curPosition.left;
      } else {
        curTop = parseFloat(curCSSTop) || 0;
        curLeft = parseFloat(curCSSLeft) || 0;
      }
      if (jQuery.isFunction(options)) {
        options = options.call(elem, i, curOffset);
      }
      if (options.top != null) {
        props.top = (options.top - curOffset.top) + curTop;
      }
      if (options.left != null) {
        props.left = (options.left - curOffset.left) + curLeft;
      }
      if ("using" in options) {
        options.using.call(elem, props);
      } else {
        curElem.css(props);
      }
    }};
  jQuery.fn.extend({
    offset: function(options) {
      if (arguments.length) {
        return options === undefined ? this : this.each(function(i) {
          jQuery.offset.setOffset(this, options, i);
        });
      }
      var docElem,
          win,
          elem = this[0],
          box = {
            top: 0,
            left: 0
          },
          doc = elem && elem.ownerDocument;
      if (!doc) {
        return ;
      }
      docElem = doc.documentElement;
      if (!jQuery.contains(docElem, elem)) {
        return box;
      }
      if (typeof elem.getBoundingClientRect !== strundefined) {
        box = elem.getBoundingClientRect();
      }
      win = getWindow(doc);
      return {
        top: box.top + win.pageYOffset - docElem.clientTop,
        left: box.left + win.pageXOffset - docElem.clientLeft
      };
    },
    position: function() {
      if (!this[0]) {
        return ;
      }
      var offsetParent,
          offset,
          elem = this[0],
          parentOffset = {
            top: 0,
            left: 0
          };
      if (jQuery.css(elem, "position") === "fixed") {
        offset = elem.getBoundingClientRect();
      } else {
        offsetParent = this.offsetParent();
        offset = this.offset();
        if (!jQuery.nodeName(offsetParent[0], "html")) {
          parentOffset = offsetParent.offset();
        }
        parentOffset.top += jQuery.css(offsetParent[0], "borderTopWidth", true);
        parentOffset.left += jQuery.css(offsetParent[0], "borderLeftWidth", true);
      }
      return {
        top: offset.top - parentOffset.top - jQuery.css(elem, "marginTop", true),
        left: offset.left - parentOffset.left - jQuery.css(elem, "marginLeft", true)
      };
    },
    offsetParent: function() {
      return this.map(function() {
        var offsetParent = this.offsetParent || docElem;
        while (offsetParent && (!jQuery.nodeName(offsetParent, "html") && jQuery.css(offsetParent, "position") === "static")) {
          offsetParent = offsetParent.offsetParent;
        }
        return offsetParent || docElem;
      });
    }
  });
  jQuery.each({
    scrollLeft: "pageXOffset",
    scrollTop: "pageYOffset"
  }, function(method, prop) {
    var top = "pageYOffset" === prop;
    jQuery.fn[method] = function(val) {
      return access(this, function(elem, method, val) {
        var win = getWindow(elem);
        if (val === undefined) {
          return win ? win[prop] : elem[method];
        }
        if (win) {
          win.scrollTo(!top ? val : window.pageXOffset, top ? val : window.pageYOffset);
        } else {
          elem[method] = val;
        }
      }, method, val, arguments.length, null);
    };
  });
  jQuery.each(["top", "left"], function(i, prop) {
    jQuery.cssHooks[prop] = addGetHookIf(support.pixelPosition, function(elem, computed) {
      if (computed) {
        computed = curCSS(elem, prop);
        return rnumnonpx.test(computed) ? jQuery(elem).position()[prop] + "px" : computed;
      }
    });
  });
  jQuery.each({
    Height: "height",
    Width: "width"
  }, function(name, type) {
    jQuery.each({
      padding: "inner" + name,
      content: type,
      "": "outer" + name
    }, function(defaultExtra, funcName) {
      jQuery.fn[funcName] = function(margin, value) {
        var chainable = arguments.length && (defaultExtra || typeof margin !== "boolean"),
            extra = defaultExtra || (margin === true || value === true ? "margin" : "border");
        return access(this, function(elem, type, value) {
          var doc;
          if (jQuery.isWindow(elem)) {
            return elem.document.documentElement["client" + name];
          }
          if (elem.nodeType === 9) {
            doc = elem.documentElement;
            return Math.max(elem.body["scroll" + name], doc["scroll" + name], elem.body["offset" + name], doc["offset" + name], doc["client" + name]);
          }
          return value === undefined ? jQuery.css(elem, type, extra) : jQuery.style(elem, type, value, extra);
        }, type, chainable ? margin : undefined, chainable, null);
      };
    });
  });
  jQuery.fn.size = function() {
    return this.length;
  };
  jQuery.fn.andSelf = jQuery.fn.addBack;
  if (typeof define === "function" && define.amd) {
    System.register("github:components/jquery@2.1.3/jquery", [], false, function(__require, __exports, __module) {
      return (function() {
        return jQuery;
      }).call(this);
    });
  }
  var _jQuery = window.jQuery,
      _$ = window.$;
  jQuery.noConflict = function(deep) {
    if (window.$ === jQuery) {
      window.$ = _$;
    }
    if (deep && window.jQuery === jQuery) {
      window.jQuery = _jQuery;
    }
    return jQuery;
  };
  if (typeof noGlobal === strundefined) {
    window.jQuery = window.$ = jQuery;
  }
  return jQuery;
}));


})();
System.register("npm:process@0.10.0/browser", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  function drainQueue() {
    if (draining) {
      return ;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      var i = -1;
      while (++i < len) {
        currentQueue[i]();
      }
      len = queue.length;
    }
    draining = false;
  }
  process.nextTick = function(fun) {
    queue.push(fun);
    if (!draining) {
      setTimeout(drainQueue, 0);
    }
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});



System.register("app/modal", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], function (_export) {
	"use strict";

	var $, _, lg, $modal, $modal_link, $modal_margin;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			$modal = $(".modal");
			$modal_link = $(".modal-link");
			$modal_margin = $(".modal-margin");
			// Margin surrounding modal that can be clicked to close

			if ($modal.length) {
				(function () {
					var show_modal =
					// Show modal
					function ($modal, scrollY) {
						var window_width = $(window).width(),
						    // Viewport width
						window_height = $(window).height(); // Viewport height

						// Show modal but hide with opacity, because we need to check if modal content is taller than viewport to make quick adjustments before making it fully visible.
						$modal.css({ opacity: 0, height: window_height }).show();

						var $article = $modal.find("article"); // The modal content area.
						var close_btn_margin = 40; // Extra margin to accommodate the Close button that sits outside modal content area.

						// If modal content is taller than viewport height
						if ($article.outerHeight() + close_btn_margin * 2 > window_height) {
							$modal.find(".modal-inner-margin").removeClass("centerV");
							$modal.find(".modal-margin").css({ height: $article.outerHeight() + close_btn_margin * 2 });
							$modal.css({ overflow: "scroll" });
							$article.css({ top: close_btn_margin });
							// If modal content is shorter than viewport height
						} else {
							$modal.find(".modal-inner-margin").addClass("centerV");
							$modal.find(".modal-margin").css({ height: "100%" });
							$modal.css({ overflow: "visible" });
							$article.css({ top: 0 });
							$modal.css({ height: window_height });
						}

						// Now show the modal
						$modal.css({ opacity: 1 });

						// Prevent scrolling of content beneath modal
						$("body").css({ overflow: "hidden" });

						// Check if modal contains video. If so, autoplay video.
						// We can assume there will only be one video.
						// There should not be any modals that contain multiple videos or videos with extensive text.
						var $video = $modal.find(".video");
						if ($video.length) {
							// All we need to do is trigger the click event on the play button.
							$video.find(".video-controls").find(".play").trigger("click");
						}
					};

					var close_all_modals =

					// Close modal
					function () {
						$modal.map(function (v, k) {
							if ($(k).css("display") === "block") {
								$(k).scrollTop(0).hide().css({ height: $(window).height() });
								//let lg_1 = $(k).attr(`class`).replace(`modal `, ``);
								//lg(`modal {blue{hidden}}: {purple{${lg_1 }}}`);
							}
						});

						// Reset body overflow to visible
						$("body").css({ overflow: "visible" });

						// Check if modal contains video. If so, then stop playback and reset playhead to the beginning.
						var $video = $modal.find(".video");
						if ($video.length) {
							var $id = $video.find("video").attr("id");
							var $v = document.getElementById($id);
							$v.pause();
							$v.currentTime = 0;
						}
					};

					// Close modal debounce
					var debounce_close_all_modals = _.debounce(close_all_modals, 200);

					// Open modal on click
					$modal_link.on("click", function (e) {
						e.preventDefault();
						var x = $(this).attr("data-modal");
						var y = $(window).scrollTop();
						show_modal($("." + x), y);
						lg("modal {blue{shown}}: {purple{" + x + "}}");
					});

					// Close modal on click
					$modal_margin.on("click", function (e) {
						if ($(e.target).is($modal_margin) || $(e.target).is(".modal-inner-margin") || $(e.target).is(".modal-close") || $(e.target).is(".icon-x")) {
							// Make sure it's only the area surrounding the modal that is clicked.
							close_all_modals();
						}
					});

					// Close modal on keyup of "escape" key
					$(document).keyup(function (e) {
						switch (e.keyCode) {
							case 27:
								// escape
								close_all_modals();
								break;
						}
						return;
					});

					// Clean up modals on resize by just hiding all of them. Debounce to throttle.
					$(window).on("resize", function () {
						debounce_close_all_modals();
					});
				})();
			}

			lg("modal {blue{loaded}}");
		}
	};
});

// ====================================
// Modal

// The modals to open/hide
// What gets clicked to open the modal
System.register("app/tooltip", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], function (_export) {
	"use strict";

	var $, _, lg, lgObj, $tooltip, $tooltip_link, $active_tooltip, $active_link;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
			lgObj = _appQuickLog.lgObj;
		}],
		execute: function () {
			$tooltip = $(".tooltip");
			$tooltip_link = $(".tooltip-link");
			$active_tooltip = undefined;
			$active_link = undefined;
			// Active link to display tooltip

			if ($tooltip.length) {
				(function () {
					var show_tooltip =

					// Show tooltip
					function () {
						// Get desired position of tooltip relative to link (We'll adjust if desired position falls outside of viewport.)
						var tooltip_position = $active_link.attr("data-tooltip-position");

						// Display tooltip but set opacity to 0 so we can set up positioning first
						$active_tooltip.css({ display: "block", opacity: 0 }).removeClass("tooltip-full");

						// Tooltip attributes
						var tooltip = {
							height: $active_tooltip.outerHeight(),
							width: $active_tooltip.outerWidth()
						};

						// Link attributes
						var link = {
							width: $active_link.outerWidth(),
							height: $active_link.outerHeight(),
							x: $active_link.offset().left,
							y: $active_link.offset().top
						};

						// Window and viewport bounds from window scroll position
						var window_width = $(window).width();
						var scrollPos = {
							top: $(window).scrollTop(),
							bottom: $(window).scrollTop() + $(window).height()
						};

						// Additional vars for calculating position
						var pointer_size = 10,
						    pointer_position_from_top_for_left_and_right = 32,
						    additional_distance = window_width > 640 ? 5 : 0; // Additional gap between link and tooltip

						// Tooltip x/y positions
						link.top = {
							x: link.x + link.width / 2 - tooltip.width / 2,
							y: link.y - pointer_size - additional_distance - tooltip.height
						};
						link.bottom = {
							x: link.x + link.width / 2 - tooltip.width / 2,
							y: link.y + link.height + pointer_size + additional_distance
						};
						link.left = {
							x: link.x - pointer_size - additional_distance - tooltip.width,
							y: link.y + link.height / 2 - pointer_position_from_top_for_left_and_right
						};
						link.right = {
							x: link.x + link.width + pointer_size + additional_distance,
							y: link.y + link.height / 2 - pointer_position_from_top_for_left_and_right
						};

						// Variables to store whether tooltip position will be inbounds or not. Initially set to 1 (yes).
						var is_in = {
							top: 1,
							bottom: 1,
							left: 1,
							right: 1,
							target_pos: "" // The desired target position of the tooltip after calculating which are inbounds or not.
						};

						// Get Corner Coordinates which we'll use to check whether potential tooltip are inbounds or not
						// Checking all potential positions first to see which are inbounds makes it easier to accommodate fallback positions from the desired position
						var corners = {
							pos_top: {
								corner1: {
									x: link.top.x,
									y: link.top.y - scrollPos.top
								},
								corner2: {
									x: link.top.x + tooltip.width,
									y: link.top.y + tooltip.height - scrollPos.top
								}
							},
							pos_bottom: {
								corner1: {
									x: link.bottom.x,
									y: link.bottom.y - scrollPos.top
								},
								corner2: {
									x: link.bottom.x + tooltip.width,
									y: link.bottom.y + tooltip.height - scrollPos.top
								}
							},
							pos_left: {
								corner1: {
									x: link.left.x,
									y: link.left.y - scrollPos.top
								},
								corner2: {
									x: link.left.x + tooltip.width,
									y: link.left.y + tooltip.height - scrollPos.top
								}
							},
							pos_right: {
								corner1: {
									x: link.right.x,
									y: link.right.y - scrollPos.top
								},
								corner2: {
									x: link.right.x + tooltip.width,
									y: link.right.y + tooltip.height - scrollPos.top
								}
							} };

						// If any corner of a potential tooltip position falls out of bounds, mark it as out of bounds
						if (corners.pos_top.corner1.x < 0 || corners.pos_top.corner1.y < 0 || corners.pos_top.corner2.x < 0 || corners.pos_top.corner2.y < 0 || corners.pos_top.corner1.x > window_width || corners.pos_top.corner1.y > scrollPos.bottom || corners.pos_top.corner2.x > window_width || corners.pos_top.corner2.y > scrollPos.bottom) {
							is_in.top = 0;
						}
						if (corners.pos_bottom.corner1.x < 0 || corners.pos_bottom.corner1.y < 0 || corners.pos_bottom.corner2.x < 0 || corners.pos_bottom.corner2.y < 0 || corners.pos_bottom.corner1.x > window_width || corners.pos_bottom.corner1.y > scrollPos.bottom || corners.pos_bottom.corner2.x > window_width || corners.pos_bottom.corner2.y > scrollPos.bottom) {
							is_in.bottom = 0;
						}
						if (corners.pos_left.corner1.x < 0 || corners.pos_left.corner1.y < 0 || corners.pos_left.corner2.x < 0 || corners.pos_left.corner2.y < 0 || corners.pos_left.corner1.x > window_width || corners.pos_left.corner1.y > scrollPos.bottom || corners.pos_left.corner2.x > window_width || corners.pos_left.corner2.y > scrollPos.bottom) {
							is_in.left = 0;
						}
						if (corners.pos_right.corner1.x < 0 || corners.pos_right.corner1.y < 0 || corners.pos_right.corner2.x < 0 || corners.pos_right.corner2.y < 0 || corners.pos_right.corner1.x > window_width || corners.pos_right.corner1.y > scrollPos.bottom || corners.pos_right.corner2.x > window_width || corners.pos_right.corner2.y > scrollPos.bottom) {
							is_in.right = 0;
						}

						// Set the actual tooltip position based on which potential positions fell within bounds.
						// If none are inbounds, set the target position to none and we will make an additional accommodation.
						if (tooltip_position === "top") {
							is_in.target_pos = is_in.top === 1 ? "top" : is_in.right === 1 ? "right" : is_in.left === 1 ? "left" : is_in.bottom === 1 ? "bottom" : "none";
						} else if (tooltip_position === "bottom") {
							is_in.target_pos = is_in.bottom === 1 ? "bottom" : is_in.right === 1 ? "right" : is_in.left === 1 ? "left" : is_in.top === 1 ? "top" : "none";
						} else if (tooltip_position === "left") {
							is_in.target_pos = is_in.left === 1 ? "left" : is_in.right === 1 ? "right" : is_in.top === 1 ? "top" : is_in.bottom === 1 ? "bottom" : "none";
						} else if (tooltip_position === "right") {
							is_in.target_pos = is_in.right === 1 ? "right" : is_in.left === 1 ? "left" : is_in.top === 1 ? "top" : is_in.bottom === 1 ? "bottom" : "none";
						}

						// If all tooltips are out of bounds, check whether top or bottom are most inbounds and display that one.
						// We're only using top and bottom, because the most common reason no potential positions would fall in bounds would be on mobile in portrait mode.
						// If we find that mobile landscapes are important, we can add additional accommodations.
						if (is_in.target_pos === "none") {
							var how_far_out = {
								top: 0,
								bottom: 0
							};

							// Calculate how far out tooltip positioned on top would be
							how_far_out.top += corners.pos_top.corner1.x < 0 ? corners.pos_top.corner1.x : 0;
							how_far_out.top -= corners.pos_top.corner1.x > window_width ? corners.pos_top.corner1.x : 0;
							how_far_out.top += corners.pos_top.corner1.y < 0 ? corners.pos_top.corner1.y : 0;
							how_far_out.top -= corners.pos_top.corner1.y > scrollPos.bottom ? corners.pos_top.corner1.y : 0;

							how_far_out.top += corners.pos_top.corner2.x < 0 ? corners.pos_top.corner2.x : 0;
							how_far_out.top -= corners.pos_top.corner2.x > window_width ? corners.pos_top.corner2.x : 0;
							how_far_out.top += corners.pos_top.corner2.y < 0 ? corners.pos_top.corner2.y : 0;
							how_far_out.top -= corners.pos_top.corner2.y > scrollPos.bottom ? corners.pos_top.corner2.y : 0;

							// Calculate how far out tooltip positioned on bottom would be
							how_far_out.bottom += corners.pos_bottom.corner1.x < 0 ? corners.pos_bottom.corner1.x : 0;
							how_far_out.bottom -= corners.pos_bottom.corner1.x > window_width ? corners.pos_bottom.corner1.x : 0;
							how_far_out.bottom += corners.pos_bottom.corner1.y < 0 ? corners.pos_bottom.corner1.y : 0;
							how_far_out.bottom -= corners.pos_bottom.corner1.y > scrollPos.bottom ? corners.pos_bottom.corner1.y : 0;

							how_far_out.bottom += corners.pos_bottom.corner2.x < 0 ? corners.pos_bottom.corner2.x : 0;
							how_far_out.bottom -= corners.pos_bottom.corner2.x > window_width ? corners.pos_bottom.corner2.x : 0;
							how_far_out.bottom += corners.pos_bottom.corner2.y < 0 ? corners.pos_bottom.corner2.y : 0;
							how_far_out.bottom -= corners.pos_bottom.corner2.y > scrollPos.bottom ? corners.pos_bottom.corner2.y : 0;

							// Set attributes regardless if it ends up on top or bottom
							addTooltipClass("tooltip-full");
							$active_tooltip.css({ left: window_width / 2 - $active_tooltip.outerWidth() / 2 });

							// Recalculate link.top.y position
							link.top.y = link.y - pointer_size - additional_distance - $active_tooltip.outerHeight();

							// Compare whether top or bottom is more inbounds and show that one
							if (how_far_out.top >= how_far_out.bottom) {
								$active_tooltip.css({ top: link.top.y });
							} else {
								$active_tooltip.css({ top: link.bottom.y });
							}
						} else {
							// Else position tooltip in following priority of if it is inbounds
							if (is_in.target_pos === "top") {
								$active_tooltip.css({ left: link.top.x, top: link.top.y });
								addTooltipClass("tooltip-top");
							} else if (is_in.target_pos === "right") {
								$active_tooltip.css({ left: link.right.x, top: link.right.y });
								addTooltipClass("tooltip-right");
							} else if (is_in.target_pos === "left") {
								$active_tooltip.css({ left: link.left.x, top: link.left.y });
								addTooltipClass("tooltip-left");
							} else if (is_in.target_pos === "bottom") {
								$active_tooltip.css({ left: link.bottom.x, top: link.bottom.y });
								addTooltipClass("tooltip-bottom");
							}
						}

						// Now show the tooltip
						$active_tooltip.css({ opacity: 1 });
					};

					var addTooltipClass = function (x) {
						$active_tooltip.removeClass("tooltip-top tooltip-bottom tooltip-left tooltip-right tooltip-full").addClass(x);
					};

					var hide_tooltip =

					// Hide tooltip
					function ($x) {
						$x.hide();
					};

					// Show tooltip debounce
					var debounce_show_tooltip = _.debounce(show_tooltip, 200);

					// Show tooltip on hover
					$tooltip_link.on("mouseenter", function () {
						$active_tooltip = $("." + $(this).attr("data-tooltip"));
						$active_link = $(this);
						debounce_show_tooltip();
					}).on("mouseleave", function () {
						debounce_show_tooltip.cancel();
						hide_tooltip($("." + $(this).attr("data-tooltip")));
					})
					// TOUCH: Toggle
					.on("touchend", function () {
						$active_tooltip = $("." + $(this).attr("data-tooltip"));
						$active_link = $(this);

						if ($active_tooltip.css("display") === "block") {
							hide_tooltip($active_tooltip);
						} else {
							$tooltip.hide();
							show_tooltip();
						}
					});

					// TOUCH: Close
					$tooltip.on("touchend", function () {
						$(this).hide();
					});
				})();
			}
			lg("tooltip {blue{loaded}}");
		}
	};
});

// ====================================
// Tooltip

// The tooltips to open/hide
// What gets hovered on to open the tooltip
// Active tooltip
System.register("app/tab", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], function (_export) {
	"use strict";

	var $, _, lg, $tab_content, $tab_link;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			$tab_content = $(".tab-content");
			$tab_link = $(".tab-link");
			// What gets clicked to open the modal

			if ($tab_content.length) {
				(function () {
					var show_tab =
					// Show tab
					function ($tab) {
						$tab.siblings(".tab-content").removeClass("active");
						$tab.addClass("active");
					};

					$tab_link.on("click", function () {
						$(this).siblings(".tab-link").removeClass("active");
						$(this).addClass("active");

						var x = $(this).attr("data-tab");
						show_tab($("." + x));
					});
				})();
			}

			lg("tab {blue{loaded}}");
		}
	};
});

// ====================================
// Modal

// The modals to open/hide
System.register("app/nav-search", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], function (_export) {
	"use strict";

	var $, _, lg, $input, $button, $results;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			$input = $(".nav-search input");
			$button = $(".nav-search button");
			$results = $(".nav_search_results");
			// Mini results (that display auto-suggestions as user types)

			if ($input.length) {
				(function () {
					var show_results =

					// Show results menu
					function () {
						position_results();
						$results.show();
					};

					var hide_results =

					// Hide results menu
					function () {
						$results.hide();
					};

					var position_results =

					// Position results menu
					function () {
						var x = $input.offset().left,
						    y = $input.offset().top,
						    h = $input.height();

						$results.css({
							top: y + h,
							left: x
						});
					};

					var placeholder_text = $input.attr("placeholder"); // Store the placeholder text

					// Debounce functions to tweak interaction timing
					var debounce_show_results = _.debounce(show_results, 240),
					    debounce_hide_results = _.debounce(hide_results, 400);

					// Input focus and blur
					$input.on("focus", function () {
						// Changes to input field and button appearance
						$(this).attr({ placeholder: "" });
						$button.toggleClass("active");

						// Change results position
						position_results();
					}).on("blur", function () {
						// Changes to input field and button appearance
						$(this).attr({ placeholder: placeholder_text }).val("");
						$button.toggleClass("active");

						hide_results();
					}).on("keypress", function () {
						debounce_show_results();
					}).on("click", function () {
						if ($(this).val() > "") {
							// Accommodates scenario: User enters text. Menu displays. User mouses over and out of menu without blurring focus of input. Menu hides. User clicks back on input field. Menu shows if the input field contains a value.
							show_results();
						}
					}).on("mouseleave", function () {
						debounce_show_results.cancel();
						debounce_hide_results();
					});

					// Results mouseenter and mouseleave
					$results.on("mouseenter", function () {
						debounce_hide_results.cancel();
					}).on("mouseleave", function () {
						debounce_show_results.cancel();
						debounce_hide_results();
					});

					// Clean up on window resize
					$(window).on("resize", function () {
						debounce_hide_results();
					});
				})();
			}

			lg("nav_search {blue{loaded}}");
		}
	};
});

// ====================================
// Navigation Search

// Search input field in header
// Search button
System.register("app/forms", ["github:components/jquery@2.1.3", "app/quick-log"], function (_export) {
	"use strict";

	var $, lg, $icon_right, $icon_left, $select_input, $textarea, $upload_input, $upload_input_button;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			// ====================================
			// Text Fields with Icon on Left or Right
			//   For input fields with an icon or text placed inside its right side,
			//   measure the width of the icon or text and add padding to the input field

			$icon_right = $(".icon-right");
			$icon_left = $(".icon-left");
			// Field with icon-left class

			if ($icon_right.length) {
				$icon_right.map(function (v, k) {
					var x = $(k).find(".form-icon").outerWidth();
					$(k).find("input").css({ "padding-right": x + 3 });
				});
			}

			// ====================================
			// Select Fields
			//   Adjust the width of the select object so it does not cover the custom drop-down arrow icon

			$select_input = $(".select-input");
			// Select input div that contains select input objects

			if ($select_input.length) {
				$select_input.map(function (v, k) {
					var x = $(k).find(".form-icon").outerWidth();
					$(k).find("select").css({ "padding-right": x + 3 });
				});
			}

			// ====================================
			// Textarea
			//   Update character count restriction or recommendation

			$textarea = $("textarea");
			// Textarea

			if ($textarea.length) {
				$textarea.map(function (v, k) {
					// Add event listener only if textarea contains a data-character-limit attribute
					if ($(k).attr("data-character-limit")) {
						$(k).on("change keyup paste", function () {
							var y = $(this).val().length;
							var z = $(k).attr("data-character-limit");

							// Update character count display and set class to bad if over the limit
							$("*[data-textarea-id='" + $(this).attr("id") + "'] span").html(z - y).addClass(z > y ? "good" : "bad").removeClass(z > y ? "bad" : "good");
						});
					}
				});
			}

			// ====================================
			// Upload
			//   Custom upload button triggers actual file input object

			$upload_input = $(".upload-input");
			$upload_input_button = $(".upload-input-button");
			// The custom upload button

			if ($upload_input.length) {
				// On click of custom button, trigger actual input field
				$upload_input_button.on("click", function () {
					var x = $(this).attr("data-file-input");
					$("#" + x).trigger("click");
				});

				// On chnage of file input field, update text display with name of selected file
				$upload_input.on("change", function () {
					var x = $(this).val();
					var y = x.substring(x.lastIndexOf("\\") + 1);

					$("*[data-file-input='" + $(this).attr("id") + "'] span").html("<i class=\"font_icon font_icon-sm icon-document legalzoom-blue\"></i>" + y).removeClass("nofile");
				});
			}


			lg("forms {blue{loaded}}");
		}
	};
});

// ====================================
// Forms

//import _ from 'lodash';
// Field with icon-right class
// Upload input field
(function() {
function define(){};  define.amd = {};
"format amd";
(function(window, document, undefined) {
  'use strict';
  var skrollr = {
    get: function() {
      return _instance;
    },
    init: function(options) {
      return _instance || new Skrollr(options);
    },
    VERSION: '0.6.29'
  };
  var hasProp = Object.prototype.hasOwnProperty;
  var Math = window.Math;
  var getStyle = window.getComputedStyle;
  var documentElement;
  var body;
  var EVENT_TOUCHSTART = 'touchstart';
  var EVENT_TOUCHMOVE = 'touchmove';
  var EVENT_TOUCHCANCEL = 'touchcancel';
  var EVENT_TOUCHEND = 'touchend';
  var SKROLLABLE_CLASS = 'skrollable';
  var SKROLLABLE_BEFORE_CLASS = SKROLLABLE_CLASS + '-before';
  var SKROLLABLE_BETWEEN_CLASS = SKROLLABLE_CLASS + '-between';
  var SKROLLABLE_AFTER_CLASS = SKROLLABLE_CLASS + '-after';
  var SKROLLR_CLASS = 'skrollr';
  var NO_SKROLLR_CLASS = 'no-' + SKROLLR_CLASS;
  var SKROLLR_DESKTOP_CLASS = SKROLLR_CLASS + '-desktop';
  var SKROLLR_MOBILE_CLASS = SKROLLR_CLASS + '-mobile';
  var DEFAULT_EASING = 'linear';
  var DEFAULT_DURATION = 1000;
  var DEFAULT_MOBILE_DECELERATION = 0.004;
  var DEFAULT_SKROLLRBODY = 'skrollr-body';
  var DEFAULT_SMOOTH_SCROLLING_DURATION = 200;
  var ANCHOR_START = 'start';
  var ANCHOR_END = 'end';
  var ANCHOR_CENTER = 'center';
  var ANCHOR_BOTTOM = 'bottom';
  var SKROLLABLE_ID_DOM_PROPERTY = '___skrollable_id';
  var rxTouchIgnoreTags = /^(?:input|textarea|button|select)$/i;
  var rxTrim = /^\s+|\s+$/g;
  var rxKeyframeAttribute = /^data(?:-(_\w+))?(?:-?(-?\d*\.?\d+p?))?(?:-?(start|end|top|center|bottom))?(?:-?(top|center|bottom))?$/;
  var rxPropValue = /\s*(@?[\w\-\[\]]+)\s*:\s*(.+?)\s*(?:;|$)/gi;
  var rxPropEasing = /^(@?[a-z\-]+)\[(\w+)\]$/;
  var rxCamelCase = /-([a-z0-9_])/g;
  var rxCamelCaseFn = function(str, letter) {
    return letter.toUpperCase();
  };
  var rxNumericValue = /[\-+]?[\d]*\.?[\d]+/g;
  var rxInterpolateString = /\{\?\}/g;
  var rxRGBAIntegerColor = /rgba?\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+/g;
  var rxGradient = /[a-z\-]+-gradient/g;
  var theCSSPrefix = '';
  var theDashedCSSPrefix = '';
  var detectCSSPrefix = function() {
    var rxPrefixes = /^(?:O|Moz|webkit|ms)|(?:-(?:o|moz|webkit|ms)-)/;
    if (!getStyle) {
      return ;
    }
    var style = getStyle(body, null);
    for (var k in style) {
      theCSSPrefix = (k.match(rxPrefixes) || (+k == k && style[k].match(rxPrefixes)));
      if (theCSSPrefix) {
        break;
      }
    }
    if (!theCSSPrefix) {
      theCSSPrefix = theDashedCSSPrefix = '';
      return ;
    }
    theCSSPrefix = theCSSPrefix[0];
    if (theCSSPrefix.slice(0, 1) === '-') {
      theDashedCSSPrefix = theCSSPrefix;
      theCSSPrefix = ({
        '-webkit-': 'webkit',
        '-moz-': 'Moz',
        '-ms-': 'ms',
        '-o-': 'O'
      })[theCSSPrefix];
    } else {
      theDashedCSSPrefix = '-' + theCSSPrefix.toLowerCase() + '-';
    }
  };
  var polyfillRAF = function() {
    var requestAnimFrame = window.requestAnimationFrame || window[theCSSPrefix.toLowerCase() + 'RequestAnimationFrame'];
    var lastTime = _now();
    if (_isMobile || !requestAnimFrame) {
      requestAnimFrame = function(callback) {
        var deltaTime = _now() - lastTime;
        var delay = Math.max(0, 1000 / 60 - deltaTime);
        return window.setTimeout(function() {
          lastTime = _now();
          callback();
        }, delay);
      };
    }
    return requestAnimFrame;
  };
  var polyfillCAF = function() {
    var cancelAnimFrame = window.cancelAnimationFrame || window[theCSSPrefix.toLowerCase() + 'CancelAnimationFrame'];
    if (_isMobile || !cancelAnimFrame) {
      cancelAnimFrame = function(timeout) {
        return window.clearTimeout(timeout);
      };
    }
    return cancelAnimFrame;
  };
  var easings = {
    begin: function() {
      return 0;
    },
    end: function() {
      return 1;
    },
    linear: function(p) {
      return p;
    },
    quadratic: function(p) {
      return p * p;
    },
    cubic: function(p) {
      return p * p * p;
    },
    swing: function(p) {
      return (-Math.cos(p * Math.PI) / 2) + 0.5;
    },
    sqrt: function(p) {
      return Math.sqrt(p);
    },
    outCubic: function(p) {
      return (Math.pow((p - 1), 3) + 1);
    },
    bounce: function(p) {
      var a;
      if (p <= 0.5083) {
        a = 3;
      } else if (p <= 0.8489) {
        a = 9;
      } else if (p <= 0.96208) {
        a = 27;
      } else if (p <= 0.99981) {
        a = 91;
      } else {
        return 1;
      }
      return 1 - Math.abs(3 * Math.cos(p * a * 1.028) / a);
    }
  };
  function Skrollr(options) {
    documentElement = document.documentElement;
    body = document.body;
    detectCSSPrefix();
    _instance = this;
    options = options || {};
    _constants = options.constants || {};
    if (options.easing) {
      for (var e in options.easing) {
        easings[e] = options.easing[e];
      }
    }
    _edgeStrategy = options.edgeStrategy || 'set';
    _listeners = {
      beforerender: options.beforerender,
      render: options.render,
      keyframe: options.keyframe
    };
    _forceHeight = options.forceHeight !== false;
    if (_forceHeight) {
      _scale = options.scale || 1;
    }
    _mobileDeceleration = options.mobileDeceleration || DEFAULT_MOBILE_DECELERATION;
    _smoothScrollingEnabled = options.smoothScrolling !== false;
    _smoothScrollingDuration = options.smoothScrollingDuration || DEFAULT_SMOOTH_SCROLLING_DURATION;
    _smoothScrolling = {targetTop: _instance.getScrollTop()};
    _isMobile = ((options.mobileCheck || function() {
      return (/Android|iPhone|iPad|iPod|BlackBerry/i).test(navigator.userAgent || navigator.vendor || window.opera);
    })());
    if (_isMobile) {
      _skrollrBody = document.getElementById(options.skrollrBody || DEFAULT_SKROLLRBODY);
      if (_skrollrBody) {
        _detect3DTransforms();
      }
      _initMobile();
      _updateClass(documentElement, [SKROLLR_CLASS, SKROLLR_MOBILE_CLASS], [NO_SKROLLR_CLASS]);
    } else {
      _updateClass(documentElement, [SKROLLR_CLASS, SKROLLR_DESKTOP_CLASS], [NO_SKROLLR_CLASS]);
    }
    _instance.refresh();
    _addEvent(window, 'resize orientationchange', function() {
      var width = documentElement.clientWidth;
      var height = documentElement.clientHeight;
      if (height !== _lastViewportHeight || width !== _lastViewportWidth) {
        _lastViewportHeight = height;
        _lastViewportWidth = width;
        _requestReflow = true;
      }
    });
    var requestAnimFrame = polyfillRAF();
    (function animloop() {
      _render();
      _animFrame = requestAnimFrame(animloop);
    }());
    return _instance;
  }
  Skrollr.prototype.refresh = function(elements) {
    var elementIndex;
    var elementsLength;
    var ignoreID = false;
    if (elements === undefined) {
      ignoreID = true;
      _skrollables = [];
      _skrollableIdCounter = 0;
      elements = document.getElementsByTagName('*');
    } else if (elements.length === undefined) {
      elements = [elements];
    }
    elementIndex = 0;
    elementsLength = elements.length;
    for (; elementIndex < elementsLength; elementIndex++) {
      var el = elements[elementIndex];
      var anchorTarget = el;
      var keyFrames = [];
      var smoothScrollThis = _smoothScrollingEnabled;
      var edgeStrategy = _edgeStrategy;
      var emitEvents = false;
      if (ignoreID && SKROLLABLE_ID_DOM_PROPERTY in el) {
        delete el[SKROLLABLE_ID_DOM_PROPERTY];
      }
      if (!el.attributes) {
        continue;
      }
      var attributeIndex = 0;
      var attributesLength = el.attributes.length;
      for (; attributeIndex < attributesLength; attributeIndex++) {
        var attr = el.attributes[attributeIndex];
        if (attr.name === 'data-anchor-target') {
          anchorTarget = document.querySelector(attr.value);
          if (anchorTarget === null) {
            throw 'Unable to find anchor target "' + attr.value + '"';
          }
          continue;
        }
        if (attr.name === 'data-smooth-scrolling') {
          smoothScrollThis = attr.value !== 'off';
          continue;
        }
        if (attr.name === 'data-edge-strategy') {
          edgeStrategy = attr.value;
          continue;
        }
        if (attr.name === 'data-emit-events') {
          emitEvents = true;
          continue;
        }
        var match = attr.name.match(rxKeyframeAttribute);
        if (match === null) {
          continue;
        }
        var kf = {
          props: attr.value,
          element: el,
          eventType: attr.name.replace(rxCamelCase, rxCamelCaseFn)
        };
        keyFrames.push(kf);
        var constant = match[1];
        if (constant) {
          kf.constant = constant.substr(1);
        }
        var offset = match[2];
        if (/p$/.test(offset)) {
          kf.isPercentage = true;
          kf.offset = (offset.slice(0, -1) | 0) / 100;
        } else {
          kf.offset = (offset | 0);
        }
        var anchor1 = match[3];
        var anchor2 = match[4] || anchor1;
        if (!anchor1 || anchor1 === ANCHOR_START || anchor1 === ANCHOR_END) {
          kf.mode = 'absolute';
          if (anchor1 === ANCHOR_END) {
            kf.isEnd = true;
          } else if (!kf.isPercentage) {
            kf.offset = kf.offset * _scale;
          }
        } else {
          kf.mode = 'relative';
          kf.anchors = [anchor1, anchor2];
        }
      }
      if (!keyFrames.length) {
        continue;
      }
      var styleAttr,
          classAttr;
      var id;
      if (!ignoreID && SKROLLABLE_ID_DOM_PROPERTY in el) {
        id = el[SKROLLABLE_ID_DOM_PROPERTY];
        styleAttr = _skrollables[id].styleAttr;
        classAttr = _skrollables[id].classAttr;
      } else {
        id = (el[SKROLLABLE_ID_DOM_PROPERTY] = _skrollableIdCounter++);
        styleAttr = el.style.cssText;
        classAttr = _getClass(el);
      }
      _skrollables[id] = {
        element: el,
        styleAttr: styleAttr,
        classAttr: classAttr,
        anchorTarget: anchorTarget,
        keyFrames: keyFrames,
        smoothScrolling: smoothScrollThis,
        edgeStrategy: edgeStrategy,
        emitEvents: emitEvents,
        lastFrameIndex: -1
      };
      _updateClass(el, [SKROLLABLE_CLASS], []);
    }
    _reflow();
    elementIndex = 0;
    elementsLength = elements.length;
    for (; elementIndex < elementsLength; elementIndex++) {
      var sk = _skrollables[elements[elementIndex][SKROLLABLE_ID_DOM_PROPERTY]];
      if (sk === undefined) {
        continue;
      }
      _parseProps(sk);
      _fillProps(sk);
    }
    return _instance;
  };
  Skrollr.prototype.relativeToAbsolute = function(element, viewportAnchor, elementAnchor) {
    var viewportHeight = documentElement.clientHeight;
    var box = element.getBoundingClientRect();
    var absolute = box.top;
    var boxHeight = box.bottom - box.top;
    if (viewportAnchor === ANCHOR_BOTTOM) {
      absolute -= viewportHeight;
    } else if (viewportAnchor === ANCHOR_CENTER) {
      absolute -= viewportHeight / 2;
    }
    if (elementAnchor === ANCHOR_BOTTOM) {
      absolute += boxHeight;
    } else if (elementAnchor === ANCHOR_CENTER) {
      absolute += boxHeight / 2;
    }
    absolute += _instance.getScrollTop();
    return (absolute + 0.5) | 0;
  };
  Skrollr.prototype.animateTo = function(top, options) {
    options = options || {};
    var now = _now();
    var scrollTop = _instance.getScrollTop();
    _scrollAnimation = {
      startTop: scrollTop,
      topDiff: top - scrollTop,
      targetTop: top,
      duration: options.duration || DEFAULT_DURATION,
      startTime: now,
      endTime: now + (options.duration || DEFAULT_DURATION),
      easing: easings[options.easing || DEFAULT_EASING],
      done: options.done
    };
    if (!_scrollAnimation.topDiff) {
      if (_scrollAnimation.done) {
        _scrollAnimation.done.call(_instance, false);
      }
      _scrollAnimation = undefined;
    }
    return _instance;
  };
  Skrollr.prototype.stopAnimateTo = function() {
    if (_scrollAnimation && _scrollAnimation.done) {
      _scrollAnimation.done.call(_instance, true);
    }
    _scrollAnimation = undefined;
  };
  Skrollr.prototype.isAnimatingTo = function() {
    return !!_scrollAnimation;
  };
  Skrollr.prototype.isMobile = function() {
    return _isMobile;
  };
  Skrollr.prototype.setScrollTop = function(top, force) {
    _forceRender = (force === true);
    if (_isMobile) {
      _mobileOffset = Math.min(Math.max(top, 0), _maxKeyFrame);
    } else {
      window.scrollTo(0, top);
    }
    return _instance;
  };
  Skrollr.prototype.getScrollTop = function() {
    if (_isMobile) {
      return _mobileOffset;
    } else {
      return window.pageYOffset || documentElement.scrollTop || body.scrollTop || 0;
    }
  };
  Skrollr.prototype.getMaxScrollTop = function() {
    return _maxKeyFrame;
  };
  Skrollr.prototype.on = function(name, fn) {
    _listeners[name] = fn;
    return _instance;
  };
  Skrollr.prototype.off = function(name) {
    delete _listeners[name];
    return _instance;
  };
  Skrollr.prototype.destroy = function() {
    var cancelAnimFrame = polyfillCAF();
    cancelAnimFrame(_animFrame);
    _removeAllEvents();
    _updateClass(documentElement, [NO_SKROLLR_CLASS], [SKROLLR_CLASS, SKROLLR_DESKTOP_CLASS, SKROLLR_MOBILE_CLASS]);
    var skrollableIndex = 0;
    var skrollablesLength = _skrollables.length;
    for (; skrollableIndex < skrollablesLength; skrollableIndex++) {
      _reset(_skrollables[skrollableIndex].element);
    }
    documentElement.style.overflow = body.style.overflow = '';
    documentElement.style.height = body.style.height = '';
    if (_skrollrBody) {
      skrollr.setStyle(_skrollrBody, 'transform', 'none');
    }
    _instance = undefined;
    _skrollrBody = undefined;
    _listeners = undefined;
    _forceHeight = undefined;
    _maxKeyFrame = 0;
    _scale = 1;
    _constants = undefined;
    _mobileDeceleration = undefined;
    _direction = 'down';
    _lastTop = -1;
    _lastViewportWidth = 0;
    _lastViewportHeight = 0;
    _requestReflow = false;
    _scrollAnimation = undefined;
    _smoothScrollingEnabled = undefined;
    _smoothScrollingDuration = undefined;
    _smoothScrolling = undefined;
    _forceRender = undefined;
    _skrollableIdCounter = 0;
    _edgeStrategy = undefined;
    _isMobile = false;
    _mobileOffset = 0;
    _translateZ = undefined;
  };
  var _initMobile = function() {
    var initialElement;
    var initialTouchY;
    var initialTouchX;
    var currentElement;
    var currentTouchY;
    var currentTouchX;
    var lastTouchY;
    var deltaY;
    var initialTouchTime;
    var currentTouchTime;
    var lastTouchTime;
    var deltaTime;
    _addEvent(documentElement, [EVENT_TOUCHSTART, EVENT_TOUCHMOVE, EVENT_TOUCHCANCEL, EVENT_TOUCHEND].join(' '), function(e) {
      var touch = e.changedTouches[0];
      currentElement = e.target;
      while (currentElement.nodeType === 3) {
        currentElement = currentElement.parentNode;
      }
      currentTouchY = touch.clientY;
      currentTouchX = touch.clientX;
      currentTouchTime = e.timeStamp;
      if (!rxTouchIgnoreTags.test(currentElement.tagName)) {
        e.preventDefault();
      }
      switch (e.type) {
        case EVENT_TOUCHSTART:
          if (initialElement) {
            initialElement.blur();
          }
          _instance.stopAnimateTo();
          initialElement = currentElement;
          initialTouchY = lastTouchY = currentTouchY;
          initialTouchX = currentTouchX;
          initialTouchTime = currentTouchTime;
          break;
        case EVENT_TOUCHMOVE:
          if (rxTouchIgnoreTags.test(currentElement.tagName) && document.activeElement !== currentElement) {
            e.preventDefault();
          }
          deltaY = currentTouchY - lastTouchY;
          deltaTime = currentTouchTime - lastTouchTime;
          _instance.setScrollTop(_mobileOffset - deltaY, true);
          lastTouchY = currentTouchY;
          lastTouchTime = currentTouchTime;
          break;
        default:
        case EVENT_TOUCHCANCEL:
        case EVENT_TOUCHEND:
          var distanceY = initialTouchY - currentTouchY;
          var distanceX = initialTouchX - currentTouchX;
          var distance2 = distanceX * distanceX + distanceY * distanceY;
          if (distance2 < 49) {
            if (!rxTouchIgnoreTags.test(initialElement.tagName)) {
              initialElement.focus();
              var clickEvent = document.createEvent('MouseEvents');
              clickEvent.initMouseEvent('click', true, true, e.view, 1, touch.screenX, touch.screenY, touch.clientX, touch.clientY, e.ctrlKey, e.altKey, e.shiftKey, e.metaKey, 0, null);
              initialElement.dispatchEvent(clickEvent);
            }
            return ;
          }
          initialElement = undefined;
          var speed = deltaY / deltaTime;
          speed = Math.max(Math.min(speed, 3), -3);
          var duration = Math.abs(speed / _mobileDeceleration);
          var targetOffset = speed * duration + 0.5 * _mobileDeceleration * duration * duration;
          var targetTop = _instance.getScrollTop() - targetOffset;
          var targetRatio = 0;
          if (targetTop > _maxKeyFrame) {
            targetRatio = (_maxKeyFrame - targetTop) / targetOffset;
            targetTop = _maxKeyFrame;
          } else if (targetTop < 0) {
            targetRatio = -targetTop / targetOffset;
            targetTop = 0;
          }
          duration = duration * (1 - targetRatio);
          _instance.animateTo((targetTop + 0.5) | 0, {
            easing: 'outCubic',
            duration: duration
          });
          break;
      }
    });
    window.scrollTo(0, 0);
    documentElement.style.overflow = body.style.overflow = 'hidden';
  };
  var _updateDependentKeyFrames = function() {
    var viewportHeight = documentElement.clientHeight;
    var processedConstants = _processConstants();
    var skrollable;
    var element;
    var anchorTarget;
    var keyFrames;
    var keyFrameIndex;
    var keyFramesLength;
    var kf;
    var skrollableIndex;
    var skrollablesLength;
    var offset;
    var constantValue;
    skrollableIndex = 0;
    skrollablesLength = _skrollables.length;
    for (; skrollableIndex < skrollablesLength; skrollableIndex++) {
      skrollable = _skrollables[skrollableIndex];
      element = skrollable.element;
      anchorTarget = skrollable.anchorTarget;
      keyFrames = skrollable.keyFrames;
      keyFrameIndex = 0;
      keyFramesLength = keyFrames.length;
      for (; keyFrameIndex < keyFramesLength; keyFrameIndex++) {
        kf = keyFrames[keyFrameIndex];
        offset = kf.offset;
        constantValue = processedConstants[kf.constant] || 0;
        kf.frame = offset;
        if (kf.isPercentage) {
          offset = offset * viewportHeight;
          kf.frame = offset;
        }
        if (kf.mode === 'relative') {
          _reset(element);
          kf.frame = _instance.relativeToAbsolute(anchorTarget, kf.anchors[0], kf.anchors[1]) - offset;
          _reset(element, true);
        }
        kf.frame += constantValue;
        if (_forceHeight) {
          if (!kf.isEnd && kf.frame > _maxKeyFrame) {
            _maxKeyFrame = kf.frame;
          }
        }
      }
    }
    _maxKeyFrame = Math.max(_maxKeyFrame, _getDocumentHeight());
    skrollableIndex = 0;
    skrollablesLength = _skrollables.length;
    for (; skrollableIndex < skrollablesLength; skrollableIndex++) {
      skrollable = _skrollables[skrollableIndex];
      keyFrames = skrollable.keyFrames;
      keyFrameIndex = 0;
      keyFramesLength = keyFrames.length;
      for (; keyFrameIndex < keyFramesLength; keyFrameIndex++) {
        kf = keyFrames[keyFrameIndex];
        constantValue = processedConstants[kf.constant] || 0;
        if (kf.isEnd) {
          kf.frame = _maxKeyFrame - kf.offset + constantValue;
        }
      }
      skrollable.keyFrames.sort(_keyFrameComparator);
    }
  };
  var _calcSteps = function(fakeFrame, actualFrame) {
    var skrollableIndex = 0;
    var skrollablesLength = _skrollables.length;
    for (; skrollableIndex < skrollablesLength; skrollableIndex++) {
      var skrollable = _skrollables[skrollableIndex];
      var element = skrollable.element;
      var frame = skrollable.smoothScrolling ? fakeFrame : actualFrame;
      var frames = skrollable.keyFrames;
      var framesLength = frames.length;
      var firstFrame = frames[0];
      var lastFrame = frames[frames.length - 1];
      var beforeFirst = frame < firstFrame.frame;
      var afterLast = frame > lastFrame.frame;
      var firstOrLastFrame = beforeFirst ? firstFrame : lastFrame;
      var emitEvents = skrollable.emitEvents;
      var lastFrameIndex = skrollable.lastFrameIndex;
      var key;
      var value;
      if (beforeFirst || afterLast) {
        if (beforeFirst && skrollable.edge === -1 || afterLast && skrollable.edge === 1) {
          continue;
        }
        if (beforeFirst) {
          _updateClass(element, [SKROLLABLE_BEFORE_CLASS], [SKROLLABLE_AFTER_CLASS, SKROLLABLE_BETWEEN_CLASS]);
          if (emitEvents && lastFrameIndex > -1) {
            _emitEvent(element, firstFrame.eventType, _direction);
            skrollable.lastFrameIndex = -1;
          }
        } else {
          _updateClass(element, [SKROLLABLE_AFTER_CLASS], [SKROLLABLE_BEFORE_CLASS, SKROLLABLE_BETWEEN_CLASS]);
          if (emitEvents && lastFrameIndex < framesLength) {
            _emitEvent(element, lastFrame.eventType, _direction);
            skrollable.lastFrameIndex = framesLength;
          }
        }
        skrollable.edge = beforeFirst ? -1 : 1;
        switch (skrollable.edgeStrategy) {
          case 'reset':
            _reset(element);
            continue;
          case 'ease':
            frame = firstOrLastFrame.frame;
            break;
          default:
          case 'set':
            var props = firstOrLastFrame.props;
            for (key in props) {
              if (hasProp.call(props, key)) {
                value = _interpolateString(props[key].value);
                if (key.indexOf('@') === 0) {
                  element.setAttribute(key.substr(1), value);
                } else {
                  skrollr.setStyle(element, key, value);
                }
              }
            }
            continue;
        }
      } else {
        if (skrollable.edge !== 0) {
          _updateClass(element, [SKROLLABLE_CLASS, SKROLLABLE_BETWEEN_CLASS], [SKROLLABLE_BEFORE_CLASS, SKROLLABLE_AFTER_CLASS]);
          skrollable.edge = 0;
        }
      }
      var keyFrameIndex = 0;
      for (; keyFrameIndex < framesLength - 1; keyFrameIndex++) {
        if (frame >= frames[keyFrameIndex].frame && frame <= frames[keyFrameIndex + 1].frame) {
          var left = frames[keyFrameIndex];
          var right = frames[keyFrameIndex + 1];
          for (key in left.props) {
            if (hasProp.call(left.props, key)) {
              var progress = (frame - left.frame) / (right.frame - left.frame);
              progress = left.props[key].easing(progress);
              value = _calcInterpolation(left.props[key].value, right.props[key].value, progress);
              value = _interpolateString(value);
              if (key.indexOf('@') === 0) {
                element.setAttribute(key.substr(1), value);
              } else {
                skrollr.setStyle(element, key, value);
              }
            }
          }
          if (emitEvents) {
            if (lastFrameIndex !== keyFrameIndex) {
              if (_direction === 'down') {
                _emitEvent(element, left.eventType, _direction);
              } else {
                _emitEvent(element, right.eventType, _direction);
              }
              skrollable.lastFrameIndex = keyFrameIndex;
            }
          }
          break;
        }
      }
    }
  };
  var _render = function() {
    if (_requestReflow) {
      _requestReflow = false;
      _reflow();
    }
    var renderTop = _instance.getScrollTop();
    var afterAnimationCallback;
    var now = _now();
    var progress;
    if (_scrollAnimation) {
      if (now >= _scrollAnimation.endTime) {
        renderTop = _scrollAnimation.targetTop;
        afterAnimationCallback = _scrollAnimation.done;
        _scrollAnimation = undefined;
      } else {
        progress = _scrollAnimation.easing((now - _scrollAnimation.startTime) / _scrollAnimation.duration);
        renderTop = (_scrollAnimation.startTop + progress * _scrollAnimation.topDiff) | 0;
      }
      _instance.setScrollTop(renderTop, true);
    } else if (!_forceRender) {
      var smoothScrollingDiff = _smoothScrolling.targetTop - renderTop;
      if (smoothScrollingDiff) {
        _smoothScrolling = {
          startTop: _lastTop,
          topDiff: renderTop - _lastTop,
          targetTop: renderTop,
          startTime: _lastRenderCall,
          endTime: _lastRenderCall + _smoothScrollingDuration
        };
      }
      if (now <= _smoothScrolling.endTime) {
        progress = easings.sqrt((now - _smoothScrolling.startTime) / _smoothScrollingDuration);
        renderTop = (_smoothScrolling.startTop + progress * _smoothScrolling.topDiff) | 0;
      }
    }
    if (_isMobile && _skrollrBody) {
      skrollr.setStyle(_skrollrBody, 'transform', 'translate(0, ' + -(_mobileOffset) + 'px) ' + _translateZ);
    }
    if (_forceRender || _lastTop !== renderTop) {
      _direction = (renderTop > _lastTop) ? 'down' : (renderTop < _lastTop ? 'up' : _direction);
      _forceRender = false;
      var listenerParams = {
        curTop: renderTop,
        lastTop: _lastTop,
        maxTop: _maxKeyFrame,
        direction: _direction
      };
      var continueRendering = _listeners.beforerender && _listeners.beforerender.call(_instance, listenerParams);
      if (continueRendering !== false) {
        _calcSteps(renderTop, _instance.getScrollTop());
        _lastTop = renderTop;
        if (_listeners.render) {
          _listeners.render.call(_instance, listenerParams);
        }
      }
      if (afterAnimationCallback) {
        afterAnimationCallback.call(_instance, false);
      }
    }
    _lastRenderCall = now;
  };
  var _parseProps = function(skrollable) {
    var keyFrameIndex = 0;
    var keyFramesLength = skrollable.keyFrames.length;
    for (; keyFrameIndex < keyFramesLength; keyFrameIndex++) {
      var frame = skrollable.keyFrames[keyFrameIndex];
      var easing;
      var value;
      var prop;
      var props = {};
      var match;
      while ((match = rxPropValue.exec(frame.props)) !== null) {
        prop = match[1];
        value = match[2];
        easing = prop.match(rxPropEasing);
        if (easing !== null) {
          prop = easing[1];
          easing = easing[2];
        } else {
          easing = DEFAULT_EASING;
        }
        value = value.indexOf('!') ? _parseProp(value) : [value.slice(1)];
        props[prop] = {
          value: value,
          easing: easings[easing]
        };
      }
      frame.props = props;
    }
  };
  var _parseProp = function(val) {
    var numbers = [];
    rxRGBAIntegerColor.lastIndex = 0;
    val = val.replace(rxRGBAIntegerColor, function(rgba) {
      return rgba.replace(rxNumericValue, function(n) {
        return n / 255 * 100 + '%';
      });
    });
    if (theDashedCSSPrefix) {
      rxGradient.lastIndex = 0;
      val = val.replace(rxGradient, function(s) {
        return theDashedCSSPrefix + s;
      });
    }
    val = val.replace(rxNumericValue, function(n) {
      numbers.push(+n);
      return '{?}';
    });
    numbers.unshift(val);
    return numbers;
  };
  var _fillProps = function(sk) {
    var propList = {};
    var keyFrameIndex;
    var keyFramesLength;
    keyFrameIndex = 0;
    keyFramesLength = sk.keyFrames.length;
    for (; keyFrameIndex < keyFramesLength; keyFrameIndex++) {
      _fillPropForFrame(sk.keyFrames[keyFrameIndex], propList);
    }
    propList = {};
    keyFrameIndex = sk.keyFrames.length - 1;
    for (; keyFrameIndex >= 0; keyFrameIndex--) {
      _fillPropForFrame(sk.keyFrames[keyFrameIndex], propList);
    }
  };
  var _fillPropForFrame = function(frame, propList) {
    var key;
    for (key in propList) {
      if (!hasProp.call(frame.props, key)) {
        frame.props[key] = propList[key];
      }
    }
    for (key in frame.props) {
      propList[key] = frame.props[key];
    }
  };
  var _calcInterpolation = function(val1, val2, progress) {
    var valueIndex;
    var val1Length = val1.length;
    if (val1Length !== val2.length) {
      throw 'Can\'t interpolate between "' + val1[0] + '" and "' + val2[0] + '"';
    }
    var interpolated = [val1[0]];
    valueIndex = 1;
    for (; valueIndex < val1Length; valueIndex++) {
      interpolated[valueIndex] = val1[valueIndex] + ((val2[valueIndex] - val1[valueIndex]) * progress);
    }
    return interpolated;
  };
  var _interpolateString = function(val) {
    var valueIndex = 1;
    rxInterpolateString.lastIndex = 0;
    return val[0].replace(rxInterpolateString, function() {
      return val[valueIndex++];
    });
  };
  var _reset = function(elements, undo) {
    elements = [].concat(elements);
    var skrollable;
    var element;
    var elementsIndex = 0;
    var elementsLength = elements.length;
    for (; elementsIndex < elementsLength; elementsIndex++) {
      element = elements[elementsIndex];
      skrollable = _skrollables[element[SKROLLABLE_ID_DOM_PROPERTY]];
      if (!skrollable) {
        continue;
      }
      if (undo) {
        element.style.cssText = skrollable.dirtyStyleAttr;
        _updateClass(element, skrollable.dirtyClassAttr);
      } else {
        skrollable.dirtyStyleAttr = element.style.cssText;
        skrollable.dirtyClassAttr = _getClass(element);
        element.style.cssText = skrollable.styleAttr;
        _updateClass(element, skrollable.classAttr);
      }
    }
  };
  var _detect3DTransforms = function() {
    _translateZ = 'translateZ(0)';
    skrollr.setStyle(_skrollrBody, 'transform', _translateZ);
    var computedStyle = getStyle(_skrollrBody);
    var computedTransform = computedStyle.getPropertyValue('transform');
    var computedTransformWithPrefix = computedStyle.getPropertyValue(theDashedCSSPrefix + 'transform');
    var has3D = (computedTransform && computedTransform !== 'none') || (computedTransformWithPrefix && computedTransformWithPrefix !== 'none');
    if (!has3D) {
      _translateZ = '';
    }
  };
  skrollr.setStyle = function(el, prop, val) {
    var style = el.style;
    prop = prop.replace(rxCamelCase, rxCamelCaseFn).replace('-', '');
    if (prop === 'zIndex') {
      if (isNaN(val)) {
        style[prop] = val;
      } else {
        style[prop] = '' + (val | 0);
      }
    } else if (prop === 'float') {
      style.styleFloat = style.cssFloat = val;
    } else {
      try {
        if (theCSSPrefix) {
          style[theCSSPrefix + prop.slice(0, 1).toUpperCase() + prop.slice(1)] = val;
        }
        style[prop] = val;
      } catch (ignore) {}
    }
  };
  var _addEvent = skrollr.addEvent = function(element, names, callback) {
    var intermediate = function(e) {
      e = e || window.event;
      if (!e.target) {
        e.target = e.srcElement;
      }
      if (!e.preventDefault) {
        e.preventDefault = function() {
          e.returnValue = false;
          e.defaultPrevented = true;
        };
      }
      return callback.call(this, e);
    };
    names = names.split(' ');
    var name;
    var nameCounter = 0;
    var namesLength = names.length;
    for (; nameCounter < namesLength; nameCounter++) {
      name = names[nameCounter];
      if (element.addEventListener) {
        element.addEventListener(name, callback, false);
      } else {
        element.attachEvent('on' + name, intermediate);
      }
      _registeredEvents.push({
        element: element,
        name: name,
        listener: callback
      });
    }
  };
  var _removeEvent = skrollr.removeEvent = function(element, names, callback) {
    names = names.split(' ');
    var nameCounter = 0;
    var namesLength = names.length;
    for (; nameCounter < namesLength; nameCounter++) {
      if (element.removeEventListener) {
        element.removeEventListener(names[nameCounter], callback, false);
      } else {
        element.detachEvent('on' + names[nameCounter], callback);
      }
    }
  };
  var _removeAllEvents = function() {
    var eventData;
    var eventCounter = 0;
    var eventsLength = _registeredEvents.length;
    for (; eventCounter < eventsLength; eventCounter++) {
      eventData = _registeredEvents[eventCounter];
      _removeEvent(eventData.element, eventData.name, eventData.listener);
    }
    _registeredEvents = [];
  };
  var _emitEvent = function(element, name, direction) {
    if (_listeners.keyframe) {
      _listeners.keyframe.call(_instance, element, name, direction);
    }
  };
  var _reflow = function() {
    var pos = _instance.getScrollTop();
    _maxKeyFrame = 0;
    if (_forceHeight && !_isMobile) {
      body.style.height = '';
    }
    _updateDependentKeyFrames();
    if (_forceHeight && !_isMobile) {
      body.style.height = (_maxKeyFrame + documentElement.clientHeight) + 'px';
    }
    if (_isMobile) {
      _instance.setScrollTop(Math.min(_instance.getScrollTop(), _maxKeyFrame));
    } else {
      _instance.setScrollTop(pos, true);
    }
    _forceRender = true;
  };
  var _processConstants = function() {
    var viewportHeight = documentElement.clientHeight;
    var copy = {};
    var prop;
    var value;
    for (prop in _constants) {
      value = _constants[prop];
      if (typeof value === 'function') {
        value = value.call(_instance);
      } else if ((/p$/).test(value)) {
        value = (value.slice(0, -1) / 100) * viewportHeight;
      }
      copy[prop] = value;
    }
    return copy;
  };
  var _getDocumentHeight = function() {
    var skrollrBodyHeight = 0;
    var bodyHeight;
    if (_skrollrBody) {
      skrollrBodyHeight = Math.max(_skrollrBody.offsetHeight, _skrollrBody.scrollHeight);
    }
    bodyHeight = Math.max(skrollrBodyHeight, body.scrollHeight, body.offsetHeight, documentElement.scrollHeight, documentElement.offsetHeight, documentElement.clientHeight);
    return bodyHeight - documentElement.clientHeight;
  };
  var _getClass = function(element) {
    var prop = 'className';
    if (window.SVGElement && element instanceof window.SVGElement) {
      element = element[prop];
      prop = 'baseVal';
    }
    return element[prop];
  };
  var _updateClass = function(element, add, remove) {
    var prop = 'className';
    if (window.SVGElement && element instanceof window.SVGElement) {
      element = element[prop];
      prop = 'baseVal';
    }
    if (remove === undefined) {
      element[prop] = add;
      return ;
    }
    var val = element[prop];
    var classRemoveIndex = 0;
    var removeLength = remove.length;
    for (; classRemoveIndex < removeLength; classRemoveIndex++) {
      val = _untrim(val).replace(_untrim(remove[classRemoveIndex]), ' ');
    }
    val = _trim(val);
    var classAddIndex = 0;
    var addLength = add.length;
    for (; classAddIndex < addLength; classAddIndex++) {
      if (_untrim(val).indexOf(_untrim(add[classAddIndex])) === -1) {
        val += ' ' + add[classAddIndex];
      }
    }
    element[prop] = _trim(val);
  };
  var _trim = function(a) {
    return a.replace(rxTrim, '');
  };
  var _untrim = function(a) {
    return ' ' + a + ' ';
  };
  var _now = Date.now || function() {
    return +new Date();
  };
  var _keyFrameComparator = function(a, b) {
    return a.frame - b.frame;
  };
  var _instance;
  var _skrollables;
  var _skrollrBody;
  var _listeners;
  var _forceHeight;
  var _maxKeyFrame = 0;
  var _scale = 1;
  var _constants;
  var _mobileDeceleration;
  var _direction = 'down';
  var _lastTop = -1;
  var _lastRenderCall = _now();
  var _lastViewportWidth = 0;
  var _lastViewportHeight = 0;
  var _requestReflow = false;
  var _scrollAnimation;
  var _smoothScrollingEnabled;
  var _smoothScrollingDuration;
  var _smoothScrolling;
  var _forceRender;
  var _skrollableIdCounter = 0;
  var _edgeStrategy;
  var _isMobile = false;
  var _mobileOffset = 0;
  var _translateZ;
  var _registeredEvents = [];
  var _animFrame;
  if (typeof define === 'function' && define.amd) {
    System.register("github:Prinzhorn/skrollr@0.6.29/skrollr", [], false, function(__require, __exports, __module) {
      return (function() {
        return skrollr;
      }).call(this);
    });
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = skrollr;
  } else {
    window.skrollr = skrollr;
  }
}(window, document));


})();
System.register("npm:slick-carousel@1.4.1/slick/slick", ["github:components/jquery@2.1.3"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(factory) {
    'use strict';
    if (typeof define === 'function' && define.amd) {
      define(["jquery"], factory);
    } else if (typeof exports !== 'undefined') {
      module.exports = factory(require("github:components/jquery@2.1.3"));
    } else {
      factory(jQuery);
    }
  }(function($) {
    'use strict';
    var Slick = window.Slick || {};
    Slick = (function() {
      var instanceUid = 0;
      function Slick(element, settings) {
        var _ = this,
            dataSettings,
            responsiveSettings,
            breakpoint;
        _.defaults = {
          accessibility: true,
          adaptiveHeight: false,
          appendArrows: $(element),
          appendDots: $(element),
          arrows: true,
          asNavFor: null,
          prevArrow: '<button type="button" data-role="none" class="slick-prev" aria-label="previous">Previous</button>',
          nextArrow: '<button type="button" data-role="none" class="slick-next" aria-label="next">Next</button>',
          autoplay: false,
          autoplaySpeed: 3000,
          centerMode: false,
          centerPadding: '50px',
          cssEase: 'ease',
          customPaging: function(slider, i) {
            return '<button type="button" data-role="none">' + (i + 1) + '</button>';
          },
          dots: false,
          dotsClass: 'slick-dots',
          draggable: true,
          easing: 'linear',
          edgeFriction: 0.35,
          fade: false,
          focusOnSelect: false,
          infinite: true,
          initialSlide: 0,
          lazyLoad: 'ondemand',
          mobileFirst: false,
          pauseOnHover: true,
          pauseOnDotsHover: false,
          respondTo: 'window',
          responsive: null,
          rtl: false,
          slide: '',
          slidesToShow: 1,
          slidesToScroll: 1,
          speed: 500,
          swipe: true,
          swipeToSlide: false,
          touchMove: true,
          touchThreshold: 5,
          useCSS: true,
          variableWidth: false,
          vertical: false,
          waitForAnimate: true
        };
        _.initials = {
          animating: false,
          dragging: false,
          autoPlayTimer: null,
          currentDirection: 0,
          currentLeft: null,
          currentSlide: 0,
          direction: 1,
          $dots: null,
          listWidth: null,
          listHeight: null,
          loadIndex: 0,
          $nextArrow: null,
          $prevArrow: null,
          slideCount: null,
          slideWidth: null,
          $slideTrack: null,
          $slides: null,
          sliding: false,
          slideOffset: 0,
          swipeLeft: null,
          $list: null,
          touchObject: {},
          transformsEnabled: false
        };
        $.extend(_, _.initials);
        _.activeBreakpoint = null;
        _.animType = null;
        _.animProp = null;
        _.breakpoints = [];
        _.breakpointSettings = [];
        _.cssTransitions = false;
        _.hidden = "hidden";
        _.paused = false;
        _.positionProp = null;
        _.respondTo = null;
        _.shouldClick = true;
        _.$slider = $(element);
        _.$slidesCache = null;
        _.transformType = null;
        _.transitionType = null;
        _.visibilityChange = "visibilitychange";
        _.windowWidth = 0;
        _.windowTimer = null;
        dataSettings = $(element).data('slick') || {};
        _.options = $.extend({}, _.defaults, dataSettings, settings);
        _.currentSlide = _.options.initialSlide;
        _.originalSettings = _.options;
        responsiveSettings = _.options.responsive || null;
        if (responsiveSettings && responsiveSettings.length > -1) {
          _.respondTo = _.options.respondTo || "window";
          for (breakpoint in responsiveSettings) {
            if (responsiveSettings.hasOwnProperty(breakpoint)) {
              _.breakpoints.push(responsiveSettings[breakpoint].breakpoint);
              _.breakpointSettings[responsiveSettings[breakpoint].breakpoint] = responsiveSettings[breakpoint].settings;
            }
          }
          _.breakpoints.sort(function(a, b) {
            if (_.options.mobileFirst === true) {
              return a - b;
            } else {
              return b - a;
            }
          });
        }
        if (typeof document.mozHidden !== "undefined") {
          _.hidden = "mozHidden";
          _.visibilityChange = "mozvisibilitychange";
        } else if (typeof document.msHidden !== "undefined") {
          _.hidden = "msHidden";
          _.visibilityChange = "msvisibilitychange";
        } else if (typeof document.webkitHidden !== "undefined") {
          _.hidden = "webkitHidden";
          _.visibilityChange = "webkitvisibilitychange";
        }
        _.autoPlay = $.proxy(_.autoPlay, _);
        _.autoPlayClear = $.proxy(_.autoPlayClear, _);
        _.changeSlide = $.proxy(_.changeSlide, _);
        _.clickHandler = $.proxy(_.clickHandler, _);
        _.selectHandler = $.proxy(_.selectHandler, _);
        _.setPosition = $.proxy(_.setPosition, _);
        _.swipeHandler = $.proxy(_.swipeHandler, _);
        _.dragHandler = $.proxy(_.dragHandler, _);
        _.keyHandler = $.proxy(_.keyHandler, _);
        _.autoPlayIterator = $.proxy(_.autoPlayIterator, _);
        _.instanceUid = instanceUid++;
        _.htmlExpr = /^(?:\s*(<[\w\W]+>)[^>]*)$/;
        _.init();
        _.checkResponsive(true);
      }
      return Slick;
    }());
    Slick.prototype.addSlide = Slick.prototype.slickAdd = function(markup, index, addBefore) {
      var _ = this;
      if (typeof(index) === 'boolean') {
        addBefore = index;
        index = null;
      } else if (index < 0 || (index >= _.slideCount)) {
        return false;
      }
      _.unload();
      if (typeof(index) === 'number') {
        if (index === 0 && _.$slides.length === 0) {
          $(markup).appendTo(_.$slideTrack);
        } else if (addBefore) {
          $(markup).insertBefore(_.$slides.eq(index));
        } else {
          $(markup).insertAfter(_.$slides.eq(index));
        }
      } else {
        if (addBefore === true) {
          $(markup).prependTo(_.$slideTrack);
        } else {
          $(markup).appendTo(_.$slideTrack);
        }
      }
      _.$slides = _.$slideTrack.children(this.options.slide);
      _.$slideTrack.children(this.options.slide).detach();
      _.$slideTrack.append(_.$slides);
      _.$slides.each(function(index, element) {
        $(element).attr("data-slick-index", index);
      });
      _.$slidesCache = _.$slides;
      _.reinit();
    };
    Slick.prototype.animateHeight = function() {
      var _ = this;
      if (_.options.slidesToShow === 1 && _.options.adaptiveHeight === true && _.options.vertical === false) {
        var targetHeight = _.$slides.eq(_.currentSlide).outerHeight(true);
        _.$list.animate({height: targetHeight}, _.options.speed);
      }
    };
    Slick.prototype.animateSlide = function(targetLeft, callback) {
      var animProps = {},
          _ = this;
      _.animateHeight();
      if (_.options.rtl === true && _.options.vertical === false) {
        targetLeft = -targetLeft;
      }
      if (_.transformsEnabled === false) {
        if (_.options.vertical === false) {
          _.$slideTrack.animate({left: targetLeft}, _.options.speed, _.options.easing, callback);
        } else {
          _.$slideTrack.animate({top: targetLeft}, _.options.speed, _.options.easing, callback);
        }
      } else {
        if (_.cssTransitions === false) {
          if (_.options.rtl === true) {
            _.currentLeft = -(_.currentLeft);
          }
          $({animStart: _.currentLeft}).animate({animStart: targetLeft}, {
            duration: _.options.speed,
            easing: _.options.easing,
            step: function(now) {
              now = Math.ceil(now);
              if (_.options.vertical === false) {
                animProps[_.animType] = 'translate(' + now + 'px, 0px)';
                _.$slideTrack.css(animProps);
              } else {
                animProps[_.animType] = 'translate(0px,' + now + 'px)';
                _.$slideTrack.css(animProps);
              }
            },
            complete: function() {
              if (callback) {
                callback.call();
              }
            }
          });
        } else {
          _.applyTransition();
          targetLeft = Math.ceil(targetLeft);
          if (_.options.vertical === false) {
            animProps[_.animType] = 'translate3d(' + targetLeft + 'px, 0px, 0px)';
          } else {
            animProps[_.animType] = 'translate3d(0px,' + targetLeft + 'px, 0px)';
          }
          _.$slideTrack.css(animProps);
          if (callback) {
            setTimeout(function() {
              _.disableTransition();
              callback.call();
            }, _.options.speed);
          }
        }
      }
    };
    Slick.prototype.asNavFor = function(index) {
      var _ = this,
          asNavFor = _.options.asNavFor !== null ? $(_.options.asNavFor).slick('getSlick') : null;
      if (asNavFor !== null)
        asNavFor.slideHandler(index, true);
    };
    Slick.prototype.applyTransition = function(slide) {
      var _ = this,
          transition = {};
      if (_.options.fade === false) {
        transition[_.transitionType] = _.transformType + ' ' + _.options.speed + 'ms ' + _.options.cssEase;
      } else {
        transition[_.transitionType] = 'opacity ' + _.options.speed + 'ms ' + _.options.cssEase;
      }
      if (_.options.fade === false) {
        _.$slideTrack.css(transition);
      } else {
        _.$slides.eq(slide).css(transition);
      }
    };
    Slick.prototype.autoPlay = function() {
      var _ = this;
      if (_.autoPlayTimer) {
        clearInterval(_.autoPlayTimer);
      }
      if (_.slideCount > _.options.slidesToShow && _.paused !== true) {
        _.autoPlayTimer = setInterval(_.autoPlayIterator, _.options.autoplaySpeed);
      }
    };
    Slick.prototype.autoPlayClear = function() {
      var _ = this;
      if (_.autoPlayTimer) {
        clearInterval(_.autoPlayTimer);
      }
    };
    Slick.prototype.autoPlayIterator = function() {
      var _ = this;
      if (_.options.infinite === false) {
        if (_.direction === 1) {
          if ((_.currentSlide + 1) === _.slideCount - 1) {
            _.direction = 0;
          }
          _.slideHandler(_.currentSlide + _.options.slidesToScroll);
        } else {
          if ((_.currentSlide - 1 === 0)) {
            _.direction = 1;
          }
          _.slideHandler(_.currentSlide - _.options.slidesToScroll);
        }
      } else {
        _.slideHandler(_.currentSlide + _.options.slidesToScroll);
      }
    };
    Slick.prototype.buildArrows = function() {
      var _ = this;
      if (_.options.arrows === true && _.slideCount > _.options.slidesToShow) {
        _.$prevArrow = $(_.options.prevArrow);
        _.$nextArrow = $(_.options.nextArrow);
        if (_.htmlExpr.test(_.options.prevArrow)) {
          _.$prevArrow.appendTo(_.options.appendArrows);
        }
        if (_.htmlExpr.test(_.options.nextArrow)) {
          _.$nextArrow.appendTo(_.options.appendArrows);
        }
        if (_.options.infinite !== true) {
          _.$prevArrow.addClass('slick-disabled');
        }
      }
    };
    Slick.prototype.buildDots = function() {
      var _ = this,
          i,
          dotString;
      if (_.options.dots === true && _.slideCount > _.options.slidesToShow) {
        dotString = '<ul class="' + _.options.dotsClass + '">';
        for (i = 0; i <= _.getDotCount(); i += 1) {
          dotString += '<li>' + _.options.customPaging.call(this, _, i) + '</li>';
        }
        dotString += '</ul>';
        _.$dots = $(dotString).appendTo(_.options.appendDots);
        _.$dots.find('li').first().addClass('slick-active').attr("aria-hidden", "false");
      }
    };
    Slick.prototype.buildOut = function() {
      var _ = this;
      _.$slides = _.$slider.children(_.options.slide + ':not(.slick-cloned)').addClass('slick-slide');
      _.slideCount = _.$slides.length;
      _.$slides.each(function(index, element) {
        $(element).attr("data-slick-index", index);
      });
      _.$slidesCache = _.$slides;
      _.$slider.addClass('slick-slider');
      _.$slideTrack = (_.slideCount === 0) ? $('<div class="slick-track"/>').appendTo(_.$slider) : _.$slides.wrapAll('<div class="slick-track"/>').parent();
      _.$list = _.$slideTrack.wrap('<div aria-live="polite" class="slick-list"/>').parent();
      _.$slideTrack.css('opacity', 0);
      if (_.options.centerMode === true || _.options.swipeToSlide === true) {
        _.options.slidesToScroll = 1;
      }
      $('img[data-lazy]', _.$slider).not('[src]').addClass('slick-loading');
      _.setupInfinite();
      _.buildArrows();
      _.buildDots();
      _.updateDots();
      if (_.options.accessibility === true) {
        _.$list.prop('tabIndex', 0);
      }
      _.setSlideClasses(typeof this.currentSlide === 'number' ? this.currentSlide : 0);
      if (_.options.draggable === true) {
        _.$list.addClass('draggable');
      }
    };
    Slick.prototype.checkResponsive = function(initial) {
      var _ = this,
          breakpoint,
          targetBreakpoint,
          respondToWidth;
      var sliderWidth = _.$slider.width();
      var windowWidth = window.innerWidth || $(window).width();
      if (_.respondTo === "window") {
        respondToWidth = windowWidth;
      } else if (_.respondTo === "slider") {
        respondToWidth = sliderWidth;
      } else if (_.respondTo === "min") {
        respondToWidth = Math.min(windowWidth, sliderWidth);
      }
      if (_.originalSettings.responsive && _.originalSettings.responsive.length > -1 && _.originalSettings.responsive !== null) {
        targetBreakpoint = null;
        for (breakpoint in _.breakpoints) {
          if (_.breakpoints.hasOwnProperty(breakpoint)) {
            if (_.originalSettings.mobileFirst === false) {
              if (respondToWidth < _.breakpoints[breakpoint]) {
                targetBreakpoint = _.breakpoints[breakpoint];
              }
            } else {
              if (respondToWidth > _.breakpoints[breakpoint]) {
                targetBreakpoint = _.breakpoints[breakpoint];
              }
            }
          }
        }
        if (targetBreakpoint !== null) {
          if (_.activeBreakpoint !== null) {
            if (targetBreakpoint !== _.activeBreakpoint) {
              _.activeBreakpoint = targetBreakpoint;
              if (_.breakpointSettings[targetBreakpoint] === "unslick") {
                _.unslick();
              } else {
                _.options = $.extend({}, _.originalSettings, _.breakpointSettings[targetBreakpoint]);
                if (initial === true)
                  _.currentSlide = _.options.initialSlide;
                _.refresh();
              }
            }
          } else {
            _.activeBreakpoint = targetBreakpoint;
            if (_.breakpointSettings[targetBreakpoint] === "unslick") {
              _.unslick();
            } else {
              _.options = $.extend({}, _.originalSettings, _.breakpointSettings[targetBreakpoint]);
              if (initial === true)
                _.currentSlide = _.options.initialSlide;
              _.refresh();
            }
          }
        } else {
          if (_.activeBreakpoint !== null) {
            _.activeBreakpoint = null;
            _.options = _.originalSettings;
            if (initial === true)
              _.currentSlide = _.options.initialSlide;
            _.refresh();
          }
        }
      }
    };
    Slick.prototype.changeSlide = function(event, dontAnimate) {
      var _ = this,
          $target = $(event.target),
          indexOffset,
          slideOffset,
          unevenOffset;
      $target.is('a') && event.preventDefault();
      unevenOffset = (_.slideCount % _.options.slidesToScroll !== 0);
      indexOffset = unevenOffset ? 0 : (_.slideCount - _.currentSlide) % _.options.slidesToScroll;
      switch (event.data.message) {
        case 'previous':
          slideOffset = indexOffset === 0 ? _.options.slidesToScroll : _.options.slidesToShow - indexOffset;
          if (_.slideCount > _.options.slidesToShow) {
            _.slideHandler(_.currentSlide - slideOffset, false, dontAnimate);
          }
          break;
        case 'next':
          slideOffset = indexOffset === 0 ? _.options.slidesToScroll : indexOffset;
          if (_.slideCount > _.options.slidesToShow) {
            _.slideHandler(_.currentSlide + slideOffset, false, dontAnimate);
          }
          break;
        case 'index':
          var index = event.data.index === 0 ? 0 : event.data.index || $(event.target).parent().index() * _.options.slidesToScroll;
          _.slideHandler(_.checkNavigable(index), false, dontAnimate);
          break;
        default:
          return ;
      }
    };
    Slick.prototype.checkNavigable = function(index) {
      var _ = this,
          navigables,
          prevNavigable;
      navigables = _.getNavigableIndexes();
      prevNavigable = 0;
      if (index > navigables[navigables.length - 1]) {
        index = navigables[navigables.length - 1];
      } else {
        for (var n in navigables) {
          if (index < navigables[n]) {
            index = prevNavigable;
            break;
          }
          prevNavigable = navigables[n];
        }
      }
      return index;
    };
    Slick.prototype.clickHandler = function(event) {
      var _ = this;
      if (_.shouldClick === false) {
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
      }
    };
    Slick.prototype.destroy = function() {
      var _ = this;
      _.autoPlayClear();
      _.touchObject = {};
      $('.slick-cloned', _.$slider).remove();
      if (_.$dots) {
        _.$dots.remove();
      }
      if (_.$prevArrow && (typeof _.options.prevArrow !== 'object')) {
        _.$prevArrow.remove();
      }
      if (_.$nextArrow && (typeof _.options.nextArrow !== 'object')) {
        _.$nextArrow.remove();
      }
      _.$slides.removeClass('slick-slide slick-active slick-center slick-visible').attr("aria-hidden", "true").removeAttr('data-slick-index').css({
        position: '',
        left: '',
        top: '',
        zIndex: '',
        opacity: '',
        width: ''
      });
      _.$slider.removeClass('slick-slider');
      _.$slider.removeClass('slick-initialized');
      _.$list.off('.slick');
      $(window).off('.slick-' + _.instanceUid);
      $(document).off('.slick-' + _.instanceUid);
      _.$slider.html(_.$slides);
    };
    Slick.prototype.disableTransition = function(slide) {
      var _ = this,
          transition = {};
      transition[_.transitionType] = "";
      if (_.options.fade === false) {
        _.$slideTrack.css(transition);
      } else {
        _.$slides.eq(slide).css(transition);
      }
    };
    Slick.prototype.fadeSlide = function(slideIndex, callback) {
      var _ = this;
      if (_.cssTransitions === false) {
        _.$slides.eq(slideIndex).css({zIndex: 1000});
        _.$slides.eq(slideIndex).animate({opacity: 1}, _.options.speed, _.options.easing, callback);
      } else {
        _.applyTransition(slideIndex);
        _.$slides.eq(slideIndex).css({
          opacity: 1,
          zIndex: 1000
        });
        if (callback) {
          setTimeout(function() {
            _.disableTransition(slideIndex);
            callback.call();
          }, _.options.speed);
        }
      }
    };
    Slick.prototype.filterSlides = Slick.prototype.slickFilter = function(filter) {
      var _ = this;
      if (filter !== null) {
        _.unload();
        _.$slideTrack.children(this.options.slide).detach();
        _.$slidesCache.filter(filter).appendTo(_.$slideTrack);
        _.reinit();
      }
    };
    Slick.prototype.getCurrent = Slick.prototype.slickCurrentSlide = function() {
      var _ = this;
      return _.currentSlide;
    };
    Slick.prototype.getDotCount = function() {
      var _ = this;
      var breakPoint = 0;
      var counter = 0;
      var pagerQty = 0;
      if (_.options.infinite === true) {
        pagerQty = Math.ceil(_.slideCount / _.options.slidesToScroll);
      } else if (_.options.centerMode === true) {
        pagerQty = _.slideCount;
      } else {
        while (breakPoint < _.slideCount) {
          ++pagerQty;
          breakPoint = counter + _.options.slidesToShow;
          counter += _.options.slidesToScroll <= _.options.slidesToShow ? _.options.slidesToScroll : _.options.slidesToShow;
        }
      }
      return pagerQty - 1;
    };
    Slick.prototype.getLeft = function(slideIndex) {
      var _ = this,
          targetLeft,
          verticalHeight,
          verticalOffset = 0,
          targetSlide;
      _.slideOffset = 0;
      verticalHeight = _.$slides.first().outerHeight();
      if (_.options.infinite === true) {
        if (_.slideCount > _.options.slidesToShow) {
          _.slideOffset = (_.slideWidth * _.options.slidesToShow) * -1;
          verticalOffset = (verticalHeight * _.options.slidesToShow) * -1;
        }
        if (_.slideCount % _.options.slidesToScroll !== 0) {
          if (slideIndex + _.options.slidesToScroll > _.slideCount && _.slideCount > _.options.slidesToShow) {
            if (slideIndex > _.slideCount) {
              _.slideOffset = ((_.options.slidesToShow - (slideIndex - _.slideCount)) * _.slideWidth) * -1;
              verticalOffset = ((_.options.slidesToShow - (slideIndex - _.slideCount)) * verticalHeight) * -1;
            } else {
              _.slideOffset = ((_.slideCount % _.options.slidesToScroll) * _.slideWidth) * -1;
              verticalOffset = ((_.slideCount % _.options.slidesToScroll) * verticalHeight) * -1;
            }
          }
        }
      } else {
        if (slideIndex + _.options.slidesToShow > _.slideCount) {
          _.slideOffset = ((slideIndex + _.options.slidesToShow) - _.slideCount) * _.slideWidth;
          verticalOffset = ((slideIndex + _.options.slidesToShow) - _.slideCount) * verticalHeight;
        }
      }
      if (_.slideCount <= _.options.slidesToShow) {
        _.slideOffset = 0;
        verticalOffset = 0;
      }
      if (_.options.centerMode === true && _.options.infinite === true) {
        _.slideOffset += _.slideWidth * Math.floor(_.options.slidesToShow / 2) - _.slideWidth;
      } else if (_.options.centerMode === true) {
        _.slideOffset = 0;
        _.slideOffset += _.slideWidth * Math.floor(_.options.slidesToShow / 2);
      }
      if (_.options.vertical === false) {
        targetLeft = ((slideIndex * _.slideWidth) * -1) + _.slideOffset;
      } else {
        targetLeft = ((slideIndex * verticalHeight) * -1) + verticalOffset;
      }
      if (_.options.variableWidth === true) {
        if (_.slideCount <= _.options.slidesToShow || _.options.infinite === false) {
          targetSlide = _.$slideTrack.children('.slick-slide').eq(slideIndex);
        } else {
          targetSlide = _.$slideTrack.children('.slick-slide').eq(slideIndex + _.options.slidesToShow);
        }
        targetLeft = targetSlide[0] ? targetSlide[0].offsetLeft * -1 : 0;
        if (_.options.centerMode === true) {
          if (_.options.infinite === false) {
            targetSlide = _.$slideTrack.children('.slick-slide').eq(slideIndex);
          } else {
            targetSlide = _.$slideTrack.children('.slick-slide').eq(slideIndex + _.options.slidesToShow + 1);
          }
          targetLeft = targetSlide[0] ? targetSlide[0].offsetLeft * -1 : 0;
          targetLeft += (_.$list.width() - targetSlide.outerWidth()) / 2;
        }
      }
      return targetLeft;
    };
    Slick.prototype.getOption = Slick.prototype.slickGetOption = function(option) {
      var _ = this;
      return _.options[option];
    };
    Slick.prototype.getNavigableIndexes = function() {
      var _ = this,
          breakPoint = 0,
          counter = 0,
          indexes = [],
          max;
      if (_.options.infinite === false) {
        max = _.slideCount - _.options.slidesToShow + 1;
        if (_.options.centerMode === true)
          max = _.slideCount;
      } else {
        breakPoint = _.slideCount * -1;
        counter = _.slideCount * -1;
        max = _.slideCount * 2;
      }
      while (breakPoint < max) {
        indexes.push(breakPoint);
        breakPoint = counter + _.options.slidesToScroll;
        counter += _.options.slidesToScroll <= _.options.slidesToShow ? _.options.slidesToScroll : _.options.slidesToShow;
      }
      return indexes;
    };
    Slick.prototype.getSlick = function() {
      return this;
    };
    Slick.prototype.getSlideCount = function() {
      var _ = this,
          slidesTraversed,
          swipedSlide,
          centerOffset;
      centerOffset = _.options.centerMode === true ? _.slideWidth * Math.floor(_.options.slidesToShow / 2) : 0;
      if (_.options.swipeToSlide === true) {
        _.$slideTrack.find('.slick-slide').each(function(index, slide) {
          if (slide.offsetLeft - centerOffset + ($(slide).outerWidth() / 2) > (_.swipeLeft * -1)) {
            swipedSlide = slide;
            return false;
          }
        });
        slidesTraversed = Math.abs($(swipedSlide).attr('data-slick-index') - _.currentSlide) || 1;
        return slidesTraversed;
      } else {
        return _.options.slidesToScroll;
      }
    };
    Slick.prototype.goTo = Slick.prototype.slickGoTo = function(slide, dontAnimate) {
      var _ = this;
      _.changeSlide({data: {
          message: 'index',
          index: parseInt(slide)
        }}, dontAnimate);
    };
    Slick.prototype.init = function() {
      var _ = this;
      if (!$(_.$slider).hasClass('slick-initialized')) {
        $(_.$slider).addClass('slick-initialized');
        _.buildOut();
        _.setProps();
        _.startLoad();
        _.loadSlider();
        _.initializeEvents();
        _.updateArrows();
        _.updateDots();
      }
      _.$slider.trigger("init", [_]);
    };
    Slick.prototype.initArrowEvents = function() {
      var _ = this;
      if (_.options.arrows === true && _.slideCount > _.options.slidesToShow) {
        _.$prevArrow.on('click.slick', {message: 'previous'}, _.changeSlide);
        _.$nextArrow.on('click.slick', {message: 'next'}, _.changeSlide);
      }
    };
    Slick.prototype.initDotEvents = function() {
      var _ = this;
      if (_.options.dots === true && _.slideCount > _.options.slidesToShow) {
        $('li', _.$dots).on('click.slick', {message: 'index'}, _.changeSlide);
      }
      if (_.options.dots === true && _.options.pauseOnDotsHover === true && _.options.autoplay === true) {
        $('li', _.$dots).on('mouseenter.slick', function() {
          _.paused = true;
          _.autoPlayClear();
        }).on('mouseleave.slick', function() {
          _.paused = false;
          _.autoPlay();
        });
      }
    };
    Slick.prototype.initializeEvents = function() {
      var _ = this;
      _.initArrowEvents();
      _.initDotEvents();
      _.$list.on('touchstart.slick mousedown.slick', {action: 'start'}, _.swipeHandler);
      _.$list.on('touchmove.slick mousemove.slick', {action: 'move'}, _.swipeHandler);
      _.$list.on('touchend.slick mouseup.slick', {action: 'end'}, _.swipeHandler);
      _.$list.on('touchcancel.slick mouseleave.slick', {action: 'end'}, _.swipeHandler);
      _.$list.on('click.slick', _.clickHandler);
      if (_.options.autoplay === true) {
        $(document).on(_.visibilityChange, function() {
          _.visibility();
        });
        if (_.options.pauseOnHover === true) {
          _.$list.on('mouseenter.slick', function() {
            _.paused = true;
            _.autoPlayClear();
          });
          _.$list.on('mouseleave.slick', function() {
            _.paused = false;
            _.autoPlay();
          });
        }
      }
      if (_.options.accessibility === true) {
        _.$list.on('keydown.slick', _.keyHandler);
      }
      if (_.options.focusOnSelect === true) {
        $(_.$slideTrack).children().on('click.slick', _.selectHandler);
      }
      $(window).on('orientationchange.slick.slick-' + _.instanceUid, function() {
        _.checkResponsive();
        _.setPosition();
      });
      $(window).on('resize.slick.slick-' + _.instanceUid, function() {
        if ($(window).width() !== _.windowWidth) {
          clearTimeout(_.windowDelay);
          _.windowDelay = window.setTimeout(function() {
            _.windowWidth = $(window).width();
            _.checkResponsive();
            _.setPosition();
          }, 50);
        }
      });
      $('*[draggable!=true]', _.$slideTrack).on('dragstart', function(e) {
        e.preventDefault();
      });
      $(window).on('load.slick.slick-' + _.instanceUid, _.setPosition);
      $(document).on('ready.slick.slick-' + _.instanceUid, _.setPosition);
    };
    Slick.prototype.initUI = function() {
      var _ = this;
      if (_.options.arrows === true && _.slideCount > _.options.slidesToShow) {
        _.$prevArrow.show();
        _.$nextArrow.show();
      }
      if (_.options.dots === true && _.slideCount > _.options.slidesToShow) {
        _.$dots.show();
      }
      if (_.options.autoplay === true) {
        _.autoPlay();
      }
    };
    Slick.prototype.keyHandler = function(event) {
      var _ = this;
      if (event.keyCode === 37 && _.options.accessibility === true) {
        _.changeSlide({data: {message: 'previous'}});
      } else if (event.keyCode === 39 && _.options.accessibility === true) {
        _.changeSlide({data: {message: 'next'}});
      }
    };
    Slick.prototype.lazyLoad = function() {
      var _ = this,
          loadRange,
          cloneRange,
          rangeStart,
          rangeEnd;
      function loadImages(imagesScope) {
        $('img[data-lazy]', imagesScope).each(function() {
          var image = $(this),
              imageSource = $(this).attr('data-lazy');
          image.load(function() {
            image.animate({opacity: 1}, 200);
          }).css({opacity: 0}).attr('src', imageSource).removeAttr('data-lazy').removeClass('slick-loading');
        });
      }
      if (_.options.centerMode === true) {
        if (_.options.infinite === true) {
          rangeStart = _.currentSlide + (_.options.slidesToShow / 2 + 1);
          rangeEnd = rangeStart + _.options.slidesToShow + 2;
        } else {
          rangeStart = Math.max(0, _.currentSlide - (_.options.slidesToShow / 2 + 1));
          rangeEnd = 2 + (_.options.slidesToShow / 2 + 1) + _.currentSlide;
        }
      } else {
        rangeStart = _.options.infinite ? _.options.slidesToShow + _.currentSlide : _.currentSlide;
        rangeEnd = rangeStart + _.options.slidesToShow;
        if (_.options.fade === true) {
          if (rangeStart > 0)
            rangeStart--;
          if (rangeEnd <= _.slideCount)
            rangeEnd++;
        }
      }
      loadRange = _.$slider.find('.slick-slide').slice(rangeStart, rangeEnd);
      loadImages(loadRange);
      if (_.slideCount <= _.options.slidesToShow) {
        cloneRange = _.$slider.find('.slick-slide');
        loadImages(cloneRange);
      } else if (_.currentSlide >= _.slideCount - _.options.slidesToShow) {
        cloneRange = _.$slider.find('.slick-cloned').slice(0, _.options.slidesToShow);
        loadImages(cloneRange);
      } else if (_.currentSlide === 0) {
        cloneRange = _.$slider.find('.slick-cloned').slice(_.options.slidesToShow * -1);
        loadImages(cloneRange);
      }
    };
    Slick.prototype.loadSlider = function() {
      var _ = this;
      _.setPosition();
      _.$slideTrack.css({opacity: 1});
      _.$slider.removeClass('slick-loading');
      _.initUI();
      if (_.options.lazyLoad === 'progressive') {
        _.progressiveLazyLoad();
      }
    };
    Slick.prototype.next = Slick.prototype.slickNext = function() {
      var _ = this;
      _.changeSlide({data: {message: 'next'}});
    };
    Slick.prototype.pause = Slick.prototype.slickPause = function() {
      var _ = this;
      _.autoPlayClear();
      _.paused = true;
    };
    Slick.prototype.play = Slick.prototype.slickPlay = function() {
      var _ = this;
      _.paused = false;
      _.autoPlay();
    };
    Slick.prototype.postSlide = function(index) {
      var _ = this;
      _.$slider.trigger("afterChange", [_, index]);
      _.animating = false;
      _.setPosition();
      _.swipeLeft = null;
      if (_.options.autoplay === true && _.paused === false) {
        _.autoPlay();
      }
    };
    Slick.prototype.prev = Slick.prototype.slickPrev = function() {
      var _ = this;
      _.changeSlide({data: {message: 'previous'}});
    };
    Slick.prototype.progressiveLazyLoad = function() {
      var _ = this,
          imgCount,
          targetImage;
      imgCount = $('img[data-lazy]', _.$slider).length;
      if (imgCount > 0) {
        targetImage = $('img[data-lazy]', _.$slider).first();
        targetImage.attr('src', targetImage.attr('data-lazy')).removeClass('slick-loading').load(function() {
          targetImage.removeAttr('data-lazy');
          _.progressiveLazyLoad();
          if (_.options.adaptiveHeight === true) {
            _.setPosition();
          }
        }).error(function() {
          targetImage.removeAttr('data-lazy');
          _.progressiveLazyLoad();
        });
      }
    };
    Slick.prototype.refresh = function() {
      var _ = this,
          currentSlide = _.currentSlide;
      _.destroy();
      $.extend(_, _.initials);
      _.init();
      _.changeSlide({data: {
          message: 'index',
          index: currentSlide
        }}, true);
    };
    Slick.prototype.reinit = function() {
      var _ = this;
      _.$slides = _.$slideTrack.children(_.options.slide).addClass('slick-slide');
      _.slideCount = _.$slides.length;
      if (_.currentSlide >= _.slideCount && _.currentSlide !== 0) {
        _.currentSlide = _.currentSlide - _.options.slidesToScroll;
      }
      if (_.slideCount <= _.options.slidesToShow) {
        _.currentSlide = 0;
      }
      _.setProps();
      _.setupInfinite();
      _.buildArrows();
      _.updateArrows();
      _.initArrowEvents();
      _.buildDots();
      _.updateDots();
      _.initDotEvents();
      if (_.options.focusOnSelect === true) {
        $(_.$slideTrack).children().on('click.slick', _.selectHandler);
      }
      _.setSlideClasses(0);
      _.setPosition();
      _.$slider.trigger("reInit", [_]);
    };
    Slick.prototype.removeSlide = Slick.prototype.slickRemove = function(index, removeBefore, removeAll) {
      var _ = this;
      if (typeof(index) === 'boolean') {
        removeBefore = index;
        index = removeBefore === true ? 0 : _.slideCount - 1;
      } else {
        index = removeBefore === true ? --index : index;
      }
      if (_.slideCount < 1 || index < 0 || index > _.slideCount - 1) {
        return false;
      }
      _.unload();
      if (removeAll === true) {
        _.$slideTrack.children().remove();
      } else {
        _.$slideTrack.children(this.options.slide).eq(index).remove();
      }
      _.$slides = _.$slideTrack.children(this.options.slide);
      _.$slideTrack.children(this.options.slide).detach();
      _.$slideTrack.append(_.$slides);
      _.$slidesCache = _.$slides;
      _.reinit();
    };
    Slick.prototype.setCSS = function(position) {
      var _ = this,
          positionProps = {},
          x,
          y;
      if (_.options.rtl === true) {
        position = -position;
      }
      x = _.positionProp == 'left' ? Math.ceil(position) + 'px' : '0px';
      y = _.positionProp == 'top' ? Math.ceil(position) + 'px' : '0px';
      positionProps[_.positionProp] = position;
      if (_.transformsEnabled === false) {
        _.$slideTrack.css(positionProps);
      } else {
        positionProps = {};
        if (_.cssTransitions === false) {
          positionProps[_.animType] = 'translate(' + x + ', ' + y + ')';
          _.$slideTrack.css(positionProps);
        } else {
          positionProps[_.animType] = 'translate3d(' + x + ', ' + y + ', 0px)';
          _.$slideTrack.css(positionProps);
        }
      }
    };
    Slick.prototype.setDimensions = function() {
      var _ = this;
      if (_.options.vertical === false) {
        if (_.options.centerMode === true) {
          _.$list.css({padding: ('0px ' + _.options.centerPadding)});
        }
      } else {
        _.$list.height(_.$slides.first().outerHeight(true) * _.options.slidesToShow);
        if (_.options.centerMode === true) {
          _.$list.css({padding: (_.options.centerPadding + ' 0px')});
        }
      }
      _.listWidth = _.$list.width();
      _.listHeight = _.$list.height();
      if (_.options.vertical === false && _.options.variableWidth === false) {
        _.slideWidth = Math.ceil(_.listWidth / _.options.slidesToShow);
        _.$slideTrack.width(Math.ceil((_.slideWidth * _.$slideTrack.children('.slick-slide').length)));
      } else if (_.options.variableWidth === true) {
        var trackWidth = 0;
        _.slideWidth = Math.ceil(_.listWidth / _.options.slidesToShow);
        _.$slideTrack.children('.slick-slide').each(function() {
          trackWidth += _.listWidth;
        });
        _.$slideTrack.width(Math.ceil(trackWidth) + 1);
      } else {
        _.slideWidth = Math.ceil(_.listWidth);
        _.$slideTrack.height(Math.ceil((_.$slides.first().outerHeight(true) * _.$slideTrack.children('.slick-slide').length)));
      }
      var offset = _.$slides.first().outerWidth(true) - _.$slides.first().width();
      if (_.options.variableWidth === false)
        _.$slideTrack.children('.slick-slide').width(_.slideWidth - offset);
    };
    Slick.prototype.setFade = function() {
      var _ = this,
          targetLeft;
      _.$slides.each(function(index, element) {
        targetLeft = (_.slideWidth * index) * -1;
        if (_.options.rtl === true) {
          $(element).css({
            position: 'relative',
            right: targetLeft,
            top: 0,
            zIndex: 800,
            opacity: 0
          });
        } else {
          $(element).css({
            position: 'relative',
            left: targetLeft,
            top: 0,
            zIndex: 800,
            opacity: 0
          });
        }
      });
      _.$slides.eq(_.currentSlide).css({
        zIndex: 900,
        opacity: 1
      });
    };
    Slick.prototype.setHeight = function() {
      var _ = this;
      if (_.options.slidesToShow === 1 && _.options.adaptiveHeight === true && _.options.vertical === false) {
        var targetHeight = _.$slides.eq(_.currentSlide).outerHeight(true);
        _.$list.css('height', targetHeight);
      }
    };
    Slick.prototype.setOption = Slick.prototype.slickSetOption = function(option, value, refresh) {
      var _ = this;
      _.options[option] = value;
      if (refresh === true) {
        _.unload();
        _.reinit();
      }
    };
    Slick.prototype.setPosition = function() {
      var _ = this;
      _.setDimensions();
      _.setHeight();
      if (_.options.fade === false) {
        _.setCSS(_.getLeft(_.currentSlide));
      } else {
        _.setFade();
      }
      _.$slider.trigger("setPosition", [_]);
    };
    Slick.prototype.setProps = function() {
      var _ = this,
          bodyStyle = document.body.style;
      _.positionProp = _.options.vertical === true ? 'top' : 'left';
      if (_.positionProp === 'top') {
        _.$slider.addClass('slick-vertical');
      } else {
        _.$slider.removeClass('slick-vertical');
      }
      if (bodyStyle.WebkitTransition !== undefined || bodyStyle.MozTransition !== undefined || bodyStyle.msTransition !== undefined) {
        if (_.options.useCSS === true) {
          _.cssTransitions = true;
        }
      }
      if (bodyStyle.OTransform !== undefined) {
        _.animType = 'OTransform';
        _.transformType = "-o-transform";
        _.transitionType = 'OTransition';
        if (bodyStyle.perspectiveProperty === undefined && bodyStyle.webkitPerspective === undefined)
          _.animType = false;
      }
      if (bodyStyle.MozTransform !== undefined) {
        _.animType = 'MozTransform';
        _.transformType = "-moz-transform";
        _.transitionType = 'MozTransition';
        if (bodyStyle.perspectiveProperty === undefined && bodyStyle.MozPerspective === undefined)
          _.animType = false;
      }
      if (bodyStyle.webkitTransform !== undefined) {
        _.animType = 'webkitTransform';
        _.transformType = "-webkit-transform";
        _.transitionType = 'webkitTransition';
        if (bodyStyle.perspectiveProperty === undefined && bodyStyle.webkitPerspective === undefined)
          _.animType = false;
      }
      if (bodyStyle.msTransform !== undefined) {
        _.animType = 'msTransform';
        _.transformType = "-ms-transform";
        _.transitionType = 'msTransition';
        if (bodyStyle.msTransform === undefined)
          _.animType = false;
      }
      if (bodyStyle.transform !== undefined && _.animType !== false) {
        _.animType = 'transform';
        _.transformType = "transform";
        _.transitionType = 'transition';
      }
      _.transformsEnabled = (_.animType !== null && _.animType !== false);
    };
    Slick.prototype.setSlideClasses = function(index) {
      var _ = this,
          centerOffset,
          allSlides,
          indexOffset,
          remainder;
      _.$slider.find('.slick-slide').removeClass('slick-active').attr("aria-hidden", "true").removeClass('slick-center');
      allSlides = _.$slider.find('.slick-slide');
      if (_.options.centerMode === true) {
        centerOffset = Math.floor(_.options.slidesToShow / 2);
        if (_.options.infinite === true) {
          if (index >= centerOffset && index <= (_.slideCount - 1) - centerOffset) {
            _.$slides.slice(index - centerOffset, index + centerOffset + 1).addClass('slick-active').attr("aria-hidden", "false");
          } else {
            indexOffset = _.options.slidesToShow + index;
            allSlides.slice(indexOffset - centerOffset + 1, indexOffset + centerOffset + 2).addClass('slick-active').attr("aria-hidden", "false");
          }
          if (index === 0) {
            allSlides.eq(allSlides.length - 1 - _.options.slidesToShow).addClass('slick-center');
          } else if (index === _.slideCount - 1) {
            allSlides.eq(_.options.slidesToShow).addClass('slick-center');
          }
        }
        _.$slides.eq(index).addClass('slick-center');
      } else {
        if (index >= 0 && index <= (_.slideCount - _.options.slidesToShow)) {
          _.$slides.slice(index, index + _.options.slidesToShow).addClass('slick-active').attr("aria-hidden", "false");
        } else if (allSlides.length <= _.options.slidesToShow) {
          allSlides.addClass('slick-active').attr("aria-hidden", "false");
        } else {
          remainder = _.slideCount % _.options.slidesToShow;
          indexOffset = _.options.infinite === true ? _.options.slidesToShow + index : index;
          if (_.options.slidesToShow == _.options.slidesToScroll && (_.slideCount - index) < _.options.slidesToShow) {
            allSlides.slice(indexOffset - (_.options.slidesToShow - remainder), indexOffset + remainder).addClass('slick-active').attr("aria-hidden", "false");
          } else {
            allSlides.slice(indexOffset, indexOffset + _.options.slidesToShow).addClass('slick-active').attr("aria-hidden", "false");
          }
        }
      }
      if (_.options.lazyLoad === 'ondemand') {
        _.lazyLoad();
      }
    };
    Slick.prototype.setupInfinite = function() {
      var _ = this,
          i,
          slideIndex,
          infiniteCount;
      if (_.options.fade === true) {
        _.options.centerMode = false;
      }
      if (_.options.infinite === true && _.options.fade === false) {
        slideIndex = null;
        if (_.slideCount > _.options.slidesToShow) {
          if (_.options.centerMode === true) {
            infiniteCount = _.options.slidesToShow + 1;
          } else {
            infiniteCount = _.options.slidesToShow;
          }
          for (i = _.slideCount; i > (_.slideCount - infiniteCount); i -= 1) {
            slideIndex = i - 1;
            $(_.$slides[slideIndex]).clone(true).attr('id', '').attr('data-slick-index', slideIndex - _.slideCount).prependTo(_.$slideTrack).addClass('slick-cloned');
          }
          for (i = 0; i < infiniteCount; i += 1) {
            slideIndex = i;
            $(_.$slides[slideIndex]).clone(true).attr('id', '').attr('data-slick-index', slideIndex + _.slideCount).appendTo(_.$slideTrack).addClass('slick-cloned');
          }
          _.$slideTrack.find('.slick-cloned').find('[id]').each(function() {
            $(this).attr('id', '');
          });
        }
      }
    };
    Slick.prototype.selectHandler = function(event) {
      var _ = this;
      var index = parseInt($(event.target).parents('.slick-slide').attr("data-slick-index"));
      if (!index)
        index = 0;
      if (_.slideCount <= _.options.slidesToShow) {
        _.$slider.find('.slick-slide').removeClass('slick-active').attr("aria-hidden", "true");
        _.$slides.eq(index).addClass('slick-active').attr("aria-hidden", "false");
        if (_.options.centerMode === true) {
          _.$slider.find('.slick-slide').removeClass('slick-center');
          _.$slides.eq(index).addClass('slick-center');
        }
        _.asNavFor(index);
        return ;
      }
      _.slideHandler(index);
    };
    Slick.prototype.slideHandler = function(index, sync, dontAnimate) {
      var targetSlide,
          animSlide,
          oldSlide,
          slideLeft,
          targetLeft = null,
          _ = this;
      sync = sync || false;
      if (_.animating === true && _.options.waitForAnimate === true) {
        return ;
      }
      if (_.options.fade === true && _.currentSlide === index) {
        return ;
      }
      if (_.slideCount <= _.options.slidesToShow) {
        return ;
      }
      if (sync === false) {
        _.asNavFor(index);
      }
      targetSlide = index;
      targetLeft = _.getLeft(targetSlide);
      slideLeft = _.getLeft(_.currentSlide);
      _.currentLeft = _.swipeLeft === null ? slideLeft : _.swipeLeft;
      if (_.options.infinite === false && _.options.centerMode === false && (index < 0 || index > _.getDotCount() * _.options.slidesToScroll)) {
        if (_.options.fade === false) {
          targetSlide = _.currentSlide;
          if (dontAnimate !== true) {
            _.animateSlide(slideLeft, function() {
              _.postSlide(targetSlide);
            });
          } else {
            _.postSlide(targetSlide);
          }
        }
        return ;
      } else if (_.options.infinite === false && _.options.centerMode === true && (index < 0 || index > (_.slideCount - _.options.slidesToScroll))) {
        if (_.options.fade === false) {
          targetSlide = _.currentSlide;
          if (dontAnimate !== true) {
            _.animateSlide(slideLeft, function() {
              _.postSlide(targetSlide);
            });
          } else {
            _.postSlide(targetSlide);
          }
        }
        return ;
      }
      if (_.options.autoplay === true) {
        clearInterval(_.autoPlayTimer);
      }
      if (targetSlide < 0) {
        if (_.slideCount % _.options.slidesToScroll !== 0) {
          animSlide = _.slideCount - (_.slideCount % _.options.slidesToScroll);
        } else {
          animSlide = _.slideCount + targetSlide;
        }
      } else if (targetSlide >= _.slideCount) {
        if (_.slideCount % _.options.slidesToScroll !== 0) {
          animSlide = 0;
        } else {
          animSlide = targetSlide - _.slideCount;
        }
      } else {
        animSlide = targetSlide;
      }
      _.animating = true;
      _.$slider.trigger("beforeChange", [_, _.currentSlide, animSlide]);
      oldSlide = _.currentSlide;
      _.currentSlide = animSlide;
      _.setSlideClasses(_.currentSlide);
      _.updateDots();
      _.updateArrows();
      if (_.options.fade === true) {
        if (dontAnimate !== true) {
          _.fadeSlide(animSlide, function() {
            _.postSlide(animSlide);
          });
        } else {
          _.postSlide(animSlide);
        }
        _.animateHeight();
        return ;
      }
      if (dontAnimate !== true) {
        _.animateSlide(targetLeft, function() {
          _.postSlide(animSlide);
        });
      } else {
        _.postSlide(animSlide);
      }
    };
    Slick.prototype.startLoad = function() {
      var _ = this;
      if (_.options.arrows === true && _.slideCount > _.options.slidesToShow) {
        _.$prevArrow.hide();
        _.$nextArrow.hide();
      }
      if (_.options.dots === true && _.slideCount > _.options.slidesToShow) {
        _.$dots.hide();
      }
      _.$slider.addClass('slick-loading');
    };
    Slick.prototype.swipeDirection = function() {
      var xDist,
          yDist,
          r,
          swipeAngle,
          _ = this;
      xDist = _.touchObject.startX - _.touchObject.curX;
      yDist = _.touchObject.startY - _.touchObject.curY;
      r = Math.atan2(yDist, xDist);
      swipeAngle = Math.round(r * 180 / Math.PI);
      if (swipeAngle < 0) {
        swipeAngle = 360 - Math.abs(swipeAngle);
      }
      if ((swipeAngle <= 45) && (swipeAngle >= 0)) {
        return (_.options.rtl === false ? 'left' : 'right');
      }
      if ((swipeAngle <= 360) && (swipeAngle >= 315)) {
        return (_.options.rtl === false ? 'left' : 'right');
      }
      if ((swipeAngle >= 135) && (swipeAngle <= 225)) {
        return (_.options.rtl === false ? 'right' : 'left');
      }
      return 'vertical';
    };
    Slick.prototype.swipeEnd = function(event) {
      var _ = this,
          slideCount;
      _.dragging = false;
      _.shouldClick = (_.touchObject.swipeLength > 10) ? false : true;
      if (_.touchObject.curX === undefined) {
        return false;
      }
      if (_.touchObject.edgeHit === true) {
        _.$slider.trigger("edge", [_, _.swipeDirection()]);
      }
      if (_.touchObject.swipeLength >= _.touchObject.minSwipe) {
        switch (_.swipeDirection()) {
          case 'left':
            slideCount = _.options.swipeToSlide ? _.checkNavigable(_.currentSlide + _.getSlideCount()) : _.currentSlide + _.getSlideCount();
            _.slideHandler(slideCount);
            _.currentDirection = 0;
            _.touchObject = {};
            _.$slider.trigger("swipe", [_, "left"]);
            break;
          case 'right':
            slideCount = _.options.swipeToSlide ? _.checkNavigable(_.currentSlide - _.getSlideCount()) : _.currentSlide - _.getSlideCount();
            _.slideHandler(slideCount);
            _.currentDirection = 1;
            _.touchObject = {};
            _.$slider.trigger("swipe", [_, "right"]);
            break;
        }
      } else {
        if (_.touchObject.startX !== _.touchObject.curX) {
          _.slideHandler(_.currentSlide);
          _.touchObject = {};
        }
      }
    };
    Slick.prototype.swipeHandler = function(event) {
      var _ = this;
      if ((_.options.swipe === false) || ('ontouchend' in document && _.options.swipe === false)) {
        return ;
      } else if (_.options.draggable === false && event.type.indexOf('mouse') !== -1) {
        return ;
      }
      _.touchObject.fingerCount = event.originalEvent && event.originalEvent.touches !== undefined ? event.originalEvent.touches.length : 1;
      _.touchObject.minSwipe = _.listWidth / _.options.touchThreshold;
      switch (event.data.action) {
        case 'start':
          _.swipeStart(event);
          break;
        case 'move':
          _.swipeMove(event);
          break;
        case 'end':
          _.swipeEnd(event);
          break;
      }
    };
    Slick.prototype.swipeMove = function(event) {
      var _ = this,
          edgeWasHit = false,
          curLeft,
          swipeDirection,
          swipeLength,
          positionOffset,
          touches;
      touches = event.originalEvent !== undefined ? event.originalEvent.touches : null;
      if (!_.dragging || touches && touches.length !== 1) {
        return false;
      }
      curLeft = _.getLeft(_.currentSlide);
      _.touchObject.curX = touches !== undefined ? touches[0].pageX : event.clientX;
      _.touchObject.curY = touches !== undefined ? touches[0].pageY : event.clientY;
      _.touchObject.swipeLength = Math.round(Math.sqrt(Math.pow(_.touchObject.curX - _.touchObject.startX, 2)));
      swipeDirection = _.swipeDirection();
      if (swipeDirection === 'vertical') {
        return ;
      }
      if (event.originalEvent !== undefined && _.touchObject.swipeLength > 4) {
        event.preventDefault();
      }
      positionOffset = (_.options.rtl === false ? 1 : -1) * (_.touchObject.curX > _.touchObject.startX ? 1 : -1);
      swipeLength = _.touchObject.swipeLength;
      _.touchObject.edgeHit = false;
      if (_.options.infinite === false) {
        if ((_.currentSlide === 0 && swipeDirection === "right") || (_.currentSlide >= _.getDotCount() && swipeDirection === "left")) {
          swipeLength = _.touchObject.swipeLength * _.options.edgeFriction;
          _.touchObject.edgeHit = true;
        }
      }
      if (_.options.vertical === false) {
        _.swipeLeft = curLeft + swipeLength * positionOffset;
      } else {
        _.swipeLeft = curLeft + (swipeLength * (_.$list.height() / _.listWidth)) * positionOffset;
      }
      if (_.options.fade === true || _.options.touchMove === false) {
        return false;
      }
      if (_.animating === true) {
        _.swipeLeft = null;
        return false;
      }
      _.setCSS(_.swipeLeft);
    };
    Slick.prototype.swipeStart = function(event) {
      var _ = this,
          touches;
      if (_.touchObject.fingerCount !== 1 || _.slideCount <= _.options.slidesToShow) {
        _.touchObject = {};
        return false;
      }
      if (event.originalEvent !== undefined && event.originalEvent.touches !== undefined) {
        touches = event.originalEvent.touches[0];
      }
      _.touchObject.startX = _.touchObject.curX = touches !== undefined ? touches.pageX : event.clientX;
      _.touchObject.startY = _.touchObject.curY = touches !== undefined ? touches.pageY : event.clientY;
      _.dragging = true;
    };
    Slick.prototype.unfilterSlides = Slick.prototype.slickUnfilter = function() {
      var _ = this;
      if (_.$slidesCache !== null) {
        _.unload();
        _.$slideTrack.children(this.options.slide).detach();
        _.$slidesCache.appendTo(_.$slideTrack);
        _.reinit();
      }
    };
    Slick.prototype.unload = function() {
      var _ = this;
      $('.slick-cloned', _.$slider).remove();
      if (_.$dots) {
        _.$dots.remove();
      }
      if (_.$prevArrow && (typeof _.options.prevArrow !== 'object')) {
        _.$prevArrow.remove();
      }
      if (_.$nextArrow && (typeof _.options.nextArrow !== 'object')) {
        _.$nextArrow.remove();
      }
      _.$slides.removeClass('slick-slide slick-active slick-visible').attr("aria-hidden", "true").css('width', '');
    };
    Slick.prototype.unslick = function() {
      var _ = this;
      _.destroy();
    };
    Slick.prototype.updateArrows = function() {
      var _ = this,
          centerOffset;
      centerOffset = Math.floor(_.options.slidesToShow / 2);
      if (_.options.arrows === true && _.options.infinite !== true && _.slideCount > _.options.slidesToShow) {
        _.$prevArrow.removeClass('slick-disabled');
        _.$nextArrow.removeClass('slick-disabled');
        if (_.currentSlide === 0) {
          _.$prevArrow.addClass('slick-disabled');
          _.$nextArrow.removeClass('slick-disabled');
        } else if (_.currentSlide >= _.slideCount - _.options.slidesToShow && _.options.centerMode === false) {
          _.$nextArrow.addClass('slick-disabled');
          _.$prevArrow.removeClass('slick-disabled');
        } else if (_.currentSlide >= _.slideCount - 1 && _.options.centerMode === true) {
          _.$nextArrow.addClass('slick-disabled');
          _.$prevArrow.removeClass('slick-disabled');
        }
      }
    };
    Slick.prototype.updateDots = function() {
      var _ = this;
      if (_.$dots !== null) {
        _.$dots.find('li').removeClass('slick-active').attr("aria-hidden", "true");
        _.$dots.find('li').eq(Math.floor(_.currentSlide / _.options.slidesToScroll)).addClass('slick-active').attr("aria-hidden", "false");
      }
    };
    Slick.prototype.visibility = function() {
      var _ = this;
      if (document[_.hidden]) {
        _.paused = true;
        _.autoPlayClear();
      } else {
        _.paused = false;
        _.autoPlay();
      }
    };
    $.fn.slick = function() {
      var _ = this,
          opt = arguments[0],
          args = Array.prototype.slice.call(arguments, 1),
          l = _.length,
          i = 0,
          ret;
      for (i; i < l; i++) {
        if (typeof opt == 'object' || typeof opt == 'undefined')
          _[i].slick = new Slick(_[i], opt);
        else
          ret = _[i].slick[opt].apply(_[i].slick, args);
        if (typeof ret != 'undefined')
          return ret;
      }
      return _;
    };
    $(function() {
      $('[data-slick]').slick();
    });
  }));
  global.define = __define;
  return module.exports;
});



System.register("app/autosuggest", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var $ = require("github:components/jquery@2.1.3");
  var _ = require("npm:lodash@3.2.0");
  var lg = require("app/quick-log");
  var $form_autocomplete = $('.form-autocomplete');
  if ($form_autocomplete.length) {
    (function($) {
      $.fn.autoSuggest = function(data, options) {
        var defaults = {
          selectedItemProp: 'value',
          selectedValuesProp: 'value',
          searchObjProps: 'value',
          minChars: 1,
          keyDelay: 100,
          resultsHighlight: true,
          showResultList: true,
          canGenerateNewSelections: true,
          start: function() {},
          selectionClick: function(elem) {},
          selectionAdded: function(elem) {},
          selectionRemoved: function(elem) {
            elem.remove();
          },
          resultClick: function(data) {},
          resultsComplete: function() {},
          keychange_one_time_kill: false
        };
        var opts = $.extend(defaults, options);
        function countValidItems(data) {
          var n = 0;
          for (k in data)
            if (data.hasOwnProperty(k))
              n++;
          return n;
        }
        var d_fetcher = function(query, next) {
          next(data, query);
        };
        if (d_fetcher) {
          return this.each(function(x) {
            if (!opts.asHtmlID) {
              x = x + '' + Math.floor(Math.random() * 100);
              var x_id = 'as-input-' + x;
            } else {
              x = opts.asHtmlID;
              var x_id = x;
            }
            opts.start.call(this, {
              add: function(data) {
                add_selected_item(data, 'u' + $('li', selections_holder).length).addClass('blur');
              },
              remove: function(value) {
                values_input.val(values_input.val().replace(',' + value + ',', ','));
                selections_holder.find('li[data-value = "' + value + '"]').remove();
              }
            });
            var input = $(this);
            input.attr('autocomplete', 'off').addClass('as-input').attr('id', x_id);
            var input_focus = false;
            input.wrap('<ul class="as-selections" id="as-selections-' + x + '" style="background:orange;"></ul>').wrap('<li class="as-original" id="as-original-' + x + '"></li>');
            var selections_holder = $('#as-selections-' + x);
            var org_li = $('#as-original-' + x);
            var results_holder = $('<div class="as-results" id="as-results-' + x + '"></div>').hide();
            var results_ul = $('<ul class="as-list"></ul>');
            var values_input = $('<input type="hidden" class="as-values" name="as_values_' + x + '" id="as-values-' + x + '" />');
            input.after(values_input);
            selections_holder.click(function() {
              input_focus = true;
              input.focus();
            }).mousedown(function() {
              input_focus = false;
            }).after(results_holder);
            var prev = '';
            var totalSelections = 0;
            var tab_press = false;
            var lastKeyPressCode = null;
            input.focus(function() {
              if (input_focus) {
                $('li.as-selection-item', selections_holder).removeClass('blur');
              }
              input_focus = true;
              return true;
            }).on('change keyup paste', function() {
              keyChange();
            }).blur(function() {
              if (input_focus) {
                $('li.as-selection-item', selections_holder).addClass('blur').removeClass('selected');
                results_holder.hide();
                input.removeClass('showing-results');
              }
            }).keydown(function(e) {
              lastKeyPressCode = e.keyCode;
              first_focus = false;
              switch (e.keyCode) {
                case 38:
                  e.preventDefault();
                  moveSelection('up');
                  break;
                case 40:
                  e.preventDefault();
                  moveSelection('down');
                  break;
                case 8:
                  if (input.val() == '') {
                    var last = values_input.val().split(',');
                    last = last[last.length - 2];
                    selections_holder.children().not(org_li.prev()).removeClass('selected');
                    if (org_li.prev().hasClass('selected')) {
                      values_input.val(values_input.val().replace(',' + last + ',', ','));
                      opts.selectionRemoved.call(this, org_li.prev());
                    } else {
                      opts.selectionClick.call(this, org_li.prev());
                      org_li.prev().addClass('selected');
                    }
                  }
                  if (input.val().length == 1) {
                    results_holder.hide();
                    input.removeClass('showing-results');
                    prev = '';
                  }
                  break;
                case 13:
                  tab_press = false;
                  var active = $('li.active:first', results_holder);
                  if (active.length > 0) {
                    active.click();
                    results_holder.hide();
                    input.removeClass('showing-results');
                  }
                  e.preventDefault();
                  break;
              }
            });
            function keyChange() {
              if (opts.keychange_one_time_kill) {
                opts.keychange_one_time_kill = false;
              } else {
                var string = input.val().replace(/[\\]+|[\/]+/g, '');
                if (string == prev)
                  return ;
                prev = string;
                if (string.length >= Number(input.attr('data-min-chars'))) {
                  results_holder.hide();
                  input.removeClass('showing-results');
                  processRequest(string);
                } else {
                  results_holder.hide();
                  input.removeClass('showing-results');
                }
              }
            }
            function processRequest(string) {
              d_fetcher(string, processData);
            }
            var num_count = 0;
            function processData(data, query) {
              query = query.toLowerCase();
              query = query.replace('(', '\\(', 'g').replace(')', '\\)', 'g');
              var matchCount = 0;
              results_holder.html(results_ul.html('')).hide();
              var d_count = countValidItems(data);
              var forward_kill = false;
              for (var i = 0; i < d_count; i++) {
                var num = i;
                num_count++;
                var forward = false;
                if (opts.searchObjProps == 'value') {
                  var str = data[num].value;
                } else {
                  var str = '';
                  var names = opts.searchObjProps.split(',');
                  for (var y = 0; y < names.length; y++) {
                    var name = $.trim(names[y]);
                    str = str + data[num][name] + ' ';
                  }
                }
                if (str) {
                  str = str.toLowerCase();
                  var this_data = $.extend({}, data[num]);
                  var eee = this_data[opts.selectedItemProp];
                  if (query.toLowerCase() === eee.toLowerCase()) {
                    forward_kill = true;
                  }
                  var str_array = str.split(',');
                  var query_array = query.split(' ');
                  var minChars = input.attr('data-min-chars');
                  query_array.map(function(a, b) {
                    str_array.map(function(v, k) {
                      if (query_array[b].length >= minChars) {
                        if (str_array[k].trim().search(query_array[b]) === 0) {
                          forward = true;
                          if (b === 0 && k === 0) {
                            forward_kill = false;
                          }
                        }
                      }
                    });
                  });
                }
                if (forward) {
                  var formatted = $('<li class="as-result-item" id="as-result-item-' + num + '"></li>').click(function() {
                    var raw_data = $(this).data('data');
                    var number = raw_data.num;
                    if ($('#as-selection-' + number, selections_holder).length <= 0 && !tab_press) {
                      var data = raw_data.attributes;
                      input.val('').focus();
                      prev = '';
                      add_selected_item(data, number);
                      opts.resultClick.call(this, raw_data);
                      results_holder.hide();
                      input.removeClass('showing-results');
                    }
                    tab_press = false;
                  }).mousedown(function() {
                    input_focus = false;
                  }).mouseover(function() {
                    $('li', results_ul).removeClass('active');
                    $(this).addClass('active');
                  }).data('data', {
                    attributes: data[num],
                    num: num_count
                  });
                  var this_data = $.extend({}, data[num]);
                  formatted = formatted.html(this_data[opts.selectedItemProp]);
                  results_ul.append(formatted);
                  delete this_data;
                  matchCount++;
                }
              }
              if (forward_kill) {
                matchCount = 0;
              }
              if (matchCount > 0) {
                results_holder.show();
                setInitialSelection();
                input.addClass('showing-results');
              }
              opts.resultsComplete.call(this);
            }
            function add_selected_item(data, num) {
              opts.keychange_one_time_kill = true;
              if (input.attr('data-selection-lowercase') === 'no') {
                input.val(data.display);
              } else {
                input.val(data.display.toLowerCase());
              }
              return org_li.prev();
            }
            function moveSelection(direction) {
              if ($(':visible', results_holder).length > 0) {
                var lis = $('li', results_holder);
                if (direction == 'down') {
                  var start = lis.eq(0);
                } else {
                  var start = lis.filter(':last');
                }
                var active = $('li.active:first', results_holder);
                if (active.length > 0) {
                  if (direction == 'down') {
                    start = active.next();
                  } else {
                    start = active.prev();
                  }
                }
                lis.removeClass('active');
                start.addClass('active');
              }
            }
            function setInitialSelection() {
              if ($(':visible', results_holder).length > 0) {
                var lis = $('li', results_holder);
                lis.removeClass('active');
                lis.eq(0).addClass('active');
              }
            }
          });
        }
      };
    })(jQuery);
    $form_autocomplete.map(function(v, k) {
      var thisID = $(k).attr('id'),
          varStr = 'data_' + thisID.replace(/-/g, '_');
      data = window[varStr];
      $(k).autoSuggest(data, {
        selectedItemProp: 'display',
        searchObjProps: 'tags'
      });
    });
  }
  lg.lg('autosuggest {blue{loaded}}');
  global.define = __define;
  return module.exports;
});



System.register("app/date-picker", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], function (_export) {
	"use strict";

	var $, _, lg, $datepicker, $datepicker_month, $button_previous, $button_next, $days_containers, $days, $readonly_field, datepicker;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			$datepicker = $(".datepicker");
			$datepicker_month = $(".datepicker > header > h1");
			$button_previous = $(".datepicker > header > .button-previous");
			$button_next = $(".datepicker > header > .button-next");
			$days_containers = $(".day-container");
			$days = $(".days");
			$readonly_field = $(".datepicker-readonly-field");
			// Read-only field that stores selected date for form submission

			if ($datepicker.length) {
				datepicker = {
					// ====================================
					// Initialize
					init: function () {
						var inputDateString = $readonly_field.val(),
						    // $readonly_field.val() can be replaced by a date the user has already selected. For example, in an incomplete questionnaire where the user has already selected a date, insert that date here so the calendar will have that date hilited and selected.
						inputDateParse = inputDateString.split("/"),
						    inputDate = new Date(inputDateParse[2], inputDateParse[0] - 1, inputDateParse[1]),
						    isDateValid = inputDate.getTime() === inputDate.getTime(); // We probably will not need this, because we should be validating the date already before we store it, but it's here just in case. Can't hurt.
						if (isDateValid) {
							this.date.current = inputDate;
							this.date.selected = inputDate;
						} else {
							this.date.current = new Date();
							this.date.selected = null;
						}
						this.date.today = new Date();
						this.buildDisplay();
					},
					// ====================================
					// Data
					date: {
						today: null, // today's date
						current: null, // current date is used for which month is displayed
						selected: null // date selected by user
					},
					months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
					holidays: [{ month: 0, day: 1, name: "New Year's Day" }, { month: 0, day: 20, name: "Martin Luther King's Birthday" }, { month: 1, day: 17, name: "George Washington's Birthday" }, { month: 4, day: 26, name: "Memorial Day" }, { month: 5, day: 4, name: "Independence Day" }, { month: 8, day: 1, name: "Labor Day" }, { month: 9, day: 13, name: "Columbus Day" }, { month: 10, day: 11, name: "Veterans Day" }, { month: 10, day: 27, name: "Thanksgiving Day" }, { month: 11, day: 25, name: "Christmas Day" }],
					options: {
						allow_weekends: $datepicker.attr("data-allow-weekends"),
						allow_holidays: $datepicker.attr("data-allow-holidays")
					},
					// ====================================
					// Render the Days of Currently-Viewed Month
					buildDisplay: function () {
						// ------------------------------------
						// Check if selected date already exists from input form and set up so day can be hilited
						var selectedDay = 0;
						if (this.date.selected) {
							var selectedMonth = this.date.selected.getUTCMonth(),
							    currentMonth = this.date.current.getUTCMonth(),
							    currentYear = this.date.current.getUTCFullYear(),
							    todaysYear = this.date.today.getUTCFullYear(),
							    holidaysThisMonth = _.filter(this.holidays, { month: currentMonth }),
							    isHoliday = 0;
							if (selectedMonth === currentMonth && !isHoliday) {
								selectedDay = this.date.selected.getUTCDate();
							}
							// Check if day is holiday. This is if user manually typed a date that is a holiday
							holidaysThisMonth.map(function (v, k) {
								if (selectedDay === v.day) {
									isHoliday = 1;
									selectedDay = 0;
								}
							});
							// ------------------------------------
							// Check if year is in current year. This is if user manually entered a year that is not the current year.
							if (currentYear !== todaysYear || isHoliday) {
								$readonly_field.val("");
								datepicker.date.selected = null;
							}
						}

						// ------------------------------------
						// Construct month day cells
						var monthFirstDay = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth(), 1),
						    monthLastDay = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() + 1, 0),
						    daysInMonth = monthLastDay.getUTCDate(),
						    emptyCellsFront = monthFirstDay.getUTCDay(),
						   
						//emptyCellsEnd = Math.ceil(daysInMonth/7) - emptyCellsFront,
						emptyCellsEnd = 6 - monthLastDay.getUTCDay(),
						    currentMonth = monthFirstDay.getUTCMonth(),
						    HTMLString = "",
						    dayCount = 0,
						    holidaysThisMonth = _.filter(this.holidays, { month: currentMonth }) // Create new object of only holidays of current month since unnecessary to check against all holiday. While not really gaining much, it simplifies that we only need to check against just the day
						;

						// ------------------------------------
						// Set up header
						$datepicker_month.html(datepicker.months[monthFirstDay.getUTCMonth()] + " " + datepicker.date.current.getUTCFullYear());

						// ------------------------------------
						// Get width of container
						var parentOuterWidth = $datepicker.parent().outerWidth();

						// ------------------------------------
						// Add days of week

						HTMLString += "" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Sun<span class=\"desktop-only\">day</span></span><span class=\"mobile-only\">S</span></div>" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Mon<span class=\"desktop-only\">day</span></span><span class=\"mobile-only\">M</span></div>" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Tue<span class=\"desktop-only\">sday</span></span><span class=\"mobile-only\">T</span></div>" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Wed<span class=\"desktop-only\">nesday</span></span><span class=\"mobile-only\">W</span></div>" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Thu<span class=\"desktop-only\">rsday</span></span><span class=\"mobile-only\">T</span></div>" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Fri<span class=\"desktop-only\">day</span></span><span class=\"mobile-only\">F</span></div>" + "<div class=\"day_of_week\"><span class=\"desktop-tablet-only\">Sat<span class=\"desktop-only\">urday</span></span><span class=\"mobile-only\">S</span></div>";

						// ------------------------------------
						// Add empty cells in front
						for (var i = 0; i < emptyCellsFront; i++) {
							dayCount++;
							if (i + 1 < emptyCellsFront) {
								HTMLString += "<div class=\"day day_empty\"><div class=\"day_number\"></div></div>";
							} else {
								HTMLString += "<div class=\"day day_empty\" style=\"width:" + parentOuterWidth * 0.134284 + "px;margin-right:1%;\"><div class=\"day_number\"></div></div>";
							}
						}
						// ------------------------------------
						// Add day cells		
						for (var i = 0; i < daysInMonth; i++) {
							dayCount++;

							// Check if this is a holiday
							var isHoliday = null,
							    holidayName = "";

							holidaysThisMonth.map(function (v, k) {
								if (v.day === i + 1) {
									isHoliday = 1;
									holidayName = v.name;
								}
							});

							if (isHoliday) {
								if (datepicker.options.allow_holidays === "no") {
									HTMLString += "<div class=\"day day_holiday\"><div class=\"day_number\">" + (i + 1) + "</div><div class=\"day_text_bottom\">" + holidayName + "</div></div>";
								} else {
									HTMLString += "<div class=\"day day_active day_holiday\"><div class=\"day_number\">" + (i + 1) + "</div><div class=\"day_text_bottom\">" + holidayName + "</div></div>";
								}
							} else {
								if (datepicker.options.allow_weekends === "no" && (dayCount % 7 === 0 || dayCount % 7 === 1)) {
									HTMLString += "<div class=\"day day_inactive\"><div class=\"day_number\">" + (i + 1) + "</div></div>";
								} else {
									if (this.date.current.getUTCMonth() === this.date.today.getUTCMonth() && this.date.current.getFullYear() === this.date.today.getFullYear() && this.date.today.getDate() === i + 1) {
										HTMLString += "<div class=\"day day_active day_today day" + (i + 1) + "\"><div class=\"day_number\">" + (i + 1) + "</div><div class=\"day_text_top\">Today</div></div>";
									} else {
										HTMLString += "<div class=\"day day_active day" + (i + 1) + "\"><div class=\"day_number\">" + (i + 1) + "</div></div>";
									}
									//if(selectedDay === (i + 1)){
									//	HTMLString += '<div class="day day_active active"><div class="day_number">' + (i + 1) + '</div></div>';
									//} else {
									//}
								}
							}
						}
						// ------------------------------------
						// Add empty cells at end
						emptyCellsEnd += 42 - (emptyCellsFront + daysInMonth + emptyCellsEnd);

						for (var i = emptyCellsEnd; i > 0; i--) {
							if ((i - 1) % 7 !== 0) {
								HTMLString += "<div class=\"day day_empty\"><div class=\"day_number\"></div></div>";
							} else {
								HTMLString += "<div class=\"day day_empty\" style=\"width:" + parentOuterWidth * 0.134284 + "px;\"><div class=\"day_number\"></div></div>";
							}
						}
						HTMLString += "<br class=\"clear\">";

						// ------------------------------------
						// Insert HTML to display
						$days.html(HTMLString);

						$(".day").map(function (v, k) {
							$(k).css({
								"margin-bottom": parentOuterWidth * 0.01
							});
						});

						// ------------------------------------
						// If a date has already been selected, then hilite that day cell
						if (selectedDay) {
							datepicker.selectDate($(".day" + selectedDay));
						}

						// ------------------------------------
						// Don't allow navigating to past months
						if (this.date.current.getUTCMonth() === this.date.today.getUTCMonth() && this.date.current.getFullYear() === this.date.today.getFullYear()) {
							$button_previous.addClass("inactive");
						} else {
							$button_previous.removeClass("inactive");
						}

						// ------------------------------------
						// Bindings
						var $day_active = $(".day_active"),
						    $day_holiday = $(".day_holiday");

						$day_active.on("mouseenter", function () {}).on("mouseleave", function () {
							var $div = $(this);
							$div.removeClass("day_style_hover");
						}).on("click touchend", function () {
							datepicker.selectDate($(this));
							datepicker.saveSelection();
						});
					},
					// ====================================
					// Select Date
					selectDate: function ($div) {
						var $day_active = $(".day_active");

						// Position Selection Border and Style cell
						var posX = $div.position().left,
						    posY = $div.position().top;
						var parentOuterWidth = $datepicker.parent().outerWidth();
						$day_active.removeClass("active");
						$div.addClass("active");

						// Set Selected Date
						var thisDay = Number($div.find(".day_number").text());
						datepicker.date.selected = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth(), thisDay);
					},
					// ====================================
					// Save Date Data to Read-Only Field
					saveSelection: function () {
						if (datepicker.date.selected) {
							var month = datepicker.date.selected.getUTCMonth() + 1,
							    day = datepicker.date.selected.getUTCDate(),
							    year = datepicker.date.selected.getUTCFullYear();
							$readonly_field.val(month + "/" + day + "/" + year);
						}
					}
				};


				// Initialize Date Picker
				datepicker.init();

				// Button Previous Month
				$button_previous.on("click touchend", function (e) {
					e.preventDefault();
					if (!$(this).hasClass("inactive")) {
						datepicker.date.current = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() - 1, 1);
						datepicker.buildDisplay();
					}
				});

				// Button Next Month
				$button_next.on("click touchend", function (e) {
					e.preventDefault();
					if (!$(this).hasClass("inactive")) {
						datepicker.date.current = new Date(datepicker.date.current.getUTCFullYear(), datepicker.date.current.getUTCMonth() + 1, 1);
						datepicker.buildDisplay();
					}
				});

				// Window Resize
				$(window).on("resize", function () {
					datepicker.init();
				});
			}

			lg("date picker {blue{loaded}}");
		}
	};
});

// ====================================
// Date Picker

// Date Picker Container
// Month text
// Previous Month Button
// Next Month Button
// Parent container of day cells
// Actual container for day cells
System.register("app/check-breakpoint", ["github:components/jquery@2.1.3", "app/quick-log"], function (_export) {
	"use strict";

	var $, lg;


	function isDesktop() {
		if ($(window).width() > 640) {
			return true;
		} else {
			return false;
		}
	}
	function isMobile() {
		if ($(window).width() <= 640) {
			return true;
		} else {
			return false;
		}
	}
	function isTablet() {
		if ($(window).width() <= 980) {
			return true;
		} else {
			return false;
		}
	}

	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			_export("isDesktop", isDesktop);

			_export("isTablet", isTablet);

			_export("isMobile", isMobile);

			lg("check breakpoint {blue{loaded}}");
		}
	};
});

// ====================================
// Check Breakpoint
System.register("app/form-custom", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log", "app/check-breakpoint"], function (_export) {
	"use strict";

	var $, _, lg, isDesktop, $form_style_1;


	// ====================================
	// Helper Functions for Custom Styles

	function get_input_width($this) {
		var x1 = $this.css("font"),
		    // Get necessary attributes to recreate object with same width
		x2 = $this.css("padding"),
		    x3 = $this.css("border-left"),
		    x4 = $this.css("border-right"),
		    x5 = $this.val(),
		    x6 = $this.attr("placeholder");
		$("body").append("<span class=\"tmp\" style=\"font:" + x1 + ";padding:" + x2 + ";border-left:" + x3 + ";border-right:" + x4 + ";background:orange;width:auto;position:absolute;opacity:0;height:0;\">" + (x5 ? x5 : x6) + "</span>"); // Create temp object
		var this_width = $(".tmp").outerWidth(); // Measure temp object
		$(".tmp").remove(); // Delete temp object
		return this_width; // Return the width
	}

	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}, function (_appCheckBreakpoint) {
			isDesktop = _appCheckBreakpoint.isDesktop;
		}],
		execute: function () {
			// ====================================
			// Form Style 1

			$form_style_1 = $(".form-style-1");


			if ($form_style_1.length) {
				(function () {
					var form_style_1_update = function () {
						if (isDesktop()) {
							// On Desktop, style elements
							$form_style_1.map(function (v, k) {
								var container_width = $(k).outerWidth(),
								    label_width = $(k).find("label").outerWidth(),
								    label_margin = Number($(k).find("label").css("margin-right").replace("px", ""));

								var $input_container = $(k).find(".input-container"),
								    // Input Container
								$input = $(k).find("input"),
								    // Input Field
								$input_underline = $(k).find(".input-underline"); // Dynamic underline

								$input_container.css({ // Set input container width to remaining width
									width: container_width - label_width - label_margin - 1
								});

								$input_underline.css({ width: get_input_width($input) }) // Set initial width of underline to match placeholder
								.on("click", function () {
									// On click, set focus on input field. For some reason, I applying any type of position attribute to the input field broke the ability to update the underline width.
									$input.focus();
								});

								$input.on("change keyup paste", function () {
									// Update width of underline as user types
									var x = get_input_width($input);
									$input_underline.css({ width: x });
								});
							});
						} else {
							// On Mobile, revert to default
							$form_style_1.map(function (v, k) {
								$(k).find(".input-container").css({
									width: "100%"
								});
							});
						}
					};

					var debounce_form_style_1_update = _.debounce(form_style_1_update, 50); // Debounce to throttle during window resize
					debounce_form_style_1_update();

					$(window).on("resize", function () {
						// Re-render on window resize
						debounce_form_style_1_update();
					});
				})();
			}lg("form custom {blue{loaded}}");
		}
	};
});

// ====================================
// Form Buttons
System.register("app/snippet-convert_time_to_HHMMSS", ["app/quick-log"], function (_export) {
	"use strict";

	var lg;
	return {
		setters: [function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			String.prototype.toHHMMSS = function () {
				var sec_num = parseInt(this, 10); // don't forget the second param
				var hours = Math.floor(sec_num / 3600);
				var minutes = Math.floor((sec_num - hours * 3600) / 60);
				var seconds = sec_num - hours * 3600 - minutes * 60;

				if (hours < 10) {
					hours = "0" + hours;
				}
				if (minutes < 10) {
					minutes = "0" + minutes;
				}
				if (seconds < 10) {
					seconds = "0" + seconds;
				}
				var time = "";
				if (hours > 0) {
					time += hours + ":";
				}
				time += minutes + ":" + seconds;
				return time;
			};

			lg("snippet-convert_time_to_HHMMSS {blue{loaded}}");
		}
	};
});

// ====================================
// Convert Time to HH:MM:SS
System.register("npm:scriptjs@2.5.7/dist/script", [], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(name, definition) {
    if (typeof module != 'undefined' && module.exports)
      module.exports = definition();
    else if (typeof define == 'function' && define.amd)
      define(definition);
    else
      this[name] = definition();
  })('$script', function() {
    var doc = document,
        head = doc.getElementsByTagName('head')[0],
        s = 'string',
        f = false,
        push = 'push',
        readyState = 'readyState',
        onreadystatechange = 'onreadystatechange',
        list = {},
        ids = {},
        delay = {},
        scripts = {},
        scriptpath,
        urlArgs;
    function every(ar, fn) {
      for (var i = 0,
          j = ar.length; i < j; ++i)
        if (!fn(ar[i]))
          return f;
      return 1;
    }
    function each(ar, fn) {
      every(ar, function(el) {
        return !fn(el);
      });
    }
    function $script(paths, idOrDone, optDone) {
      paths = paths[push] ? paths : [paths];
      var idOrDoneIsDone = idOrDone && idOrDone.call,
          done = idOrDoneIsDone ? idOrDone : optDone,
          id = idOrDoneIsDone ? paths.join('') : idOrDone,
          queue = paths.length;
      function loopFn(item) {
        return item.call ? item() : list[item];
      }
      function callback() {
        if (!--queue) {
          list[id] = 1;
          done && done();
          for (var dset in delay) {
            every(dset.split('|'), loopFn) && !each(delay[dset], loopFn) && (delay[dset] = []);
          }
        }
      }
      setTimeout(function() {
        each(paths, function loading(path, force) {
          if (path === null)
            return callback();
          path = !force && path.indexOf('.js') === -1 && !/^https?:\/\//.test(path) && scriptpath ? scriptpath + path + '.js' : path;
          if (scripts[path]) {
            if (id)
              ids[id] = 1;
            return (scripts[path] == 2) ? callback() : setTimeout(function() {
              loading(path, true);
            }, 0);
          }
          scripts[path] = 1;
          if (id)
            ids[id] = 1;
          create(path, callback);
        });
      }, 0);
      return $script;
    }
    function create(path, fn) {
      var el = doc.createElement('script'),
          loaded;
      el.onload = el.onerror = el[onreadystatechange] = function() {
        if ((el[readyState] && !(/^c|loade/.test(el[readyState]))) || loaded)
          return ;
        el.onload = el[onreadystatechange] = null;
        loaded = 1;
        scripts[path] = 2;
        fn();
      };
      el.async = 1;
      el.src = urlArgs ? path + (path.indexOf('?') === -1 ? '?' : '&') + urlArgs : path;
      head.insertBefore(el, head.lastChild);
    }
    $script.get = create;
    $script.order = function(scripts, id, done) {
      (function callback(s) {
        s = scripts.shift();
        !scripts.length ? $script(s, id, done) : $script(s, callback);
      }());
    };
    $script.path = function(p) {
      scriptpath = p;
    };
    $script.urlArgs = function(str) {
      urlArgs = str;
    };
    $script.ready = function(deps, ready, req) {
      deps = deps[push] ? deps : [deps];
      var missing = [];
      !each(deps, function(dep) {
        list[dep] || missing[push](dep);
      }) && every(deps, function(dep) {
        return list[dep];
      }) ? ready() : !function(key) {
        delay[key] = delay[key] || [];
        delay[key][push](ready);
        req && req(missing);
      }(deps.join('|'));
      return $script;
    };
    $script.done = function(idOrDone) {
      $script([null], idOrDone);
    };
    return $script;
  });
  global.define = __define;
  return module.exports;
});



System.register("npm:asap@1.0.0/asap", ["github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var head = {
      task: void 0,
      next: null
    };
    var tail = head;
    var flushing = false;
    var requestFlush = void 0;
    var isNodeJS = false;
    function flush() {
      while (head.next) {
        head = head.next;
        var task = head.task;
        head.task = void 0;
        var domain = head.domain;
        if (domain) {
          head.domain = void 0;
          domain.enter();
        }
        try {
          task();
        } catch (e) {
          if (isNodeJS) {
            if (domain) {
              domain.exit();
            }
            setTimeout(flush, 0);
            if (domain) {
              domain.enter();
            }
            throw e;
          } else {
            setTimeout(function() {
              throw e;
            }, 0);
          }
        }
        if (domain) {
          domain.exit();
        }
      }
      flushing = false;
    }
    if (typeof process !== "undefined" && process.nextTick) {
      isNodeJS = true;
      requestFlush = function() {
        process.nextTick(flush);
      };
    } else if (typeof setImmediate === "function") {
      if (typeof window !== "undefined") {
        requestFlush = setImmediate.bind(window, flush);
      } else {
        requestFlush = function() {
          setImmediate(flush);
        };
      }
    } else if (typeof MessageChannel !== "undefined") {
      var channel = new MessageChannel();
      channel.port1.onmessage = flush;
      requestFlush = function() {
        channel.port2.postMessage(0);
      };
    } else {
      requestFlush = function() {
        setTimeout(flush, 0);
      };
    }
    function asap(task) {
      tail = tail.next = {
        task: task,
        domain: isNodeJS && process.domain,
        next: null
      };
      if (!flushing) {
        flushing = true;
        requestFlush();
      }
    }
    ;
    module.exports = asap;
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});



System.register("npm:promise@6.1.0/lib/done", ["npm:promise@6.1.0/lib/core", "npm:asap@1.0.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var Promise = require("npm:promise@6.1.0/lib/core");
  var asap = require("npm:asap@1.0.0");
  module.exports = Promise;
  Promise.prototype.done = function(onFulfilled, onRejected) {
    var self = arguments.length ? this.then.apply(this, arguments) : this;
    self.then(null, function(err) {
      asap(function() {
        throw err;
      });
    });
  };
  global.define = __define;
  return module.exports;
});



System.register("npm:promise@6.1.0/lib/es6-extensions", ["npm:promise@6.1.0/lib/core", "npm:asap@1.0.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var Promise = require("npm:promise@6.1.0/lib/core");
  var asap = require("npm:asap@1.0.0");
  module.exports = Promise;
  function ValuePromise(value) {
    this.then = function(onFulfilled) {
      if (typeof onFulfilled !== 'function')
        return this;
      return new Promise(function(resolve, reject) {
        asap(function() {
          try {
            resolve(onFulfilled(value));
          } catch (ex) {
            reject(ex);
          }
        });
      });
    };
  }
  ValuePromise.prototype = Promise.prototype;
  var TRUE = new ValuePromise(true);
  var FALSE = new ValuePromise(false);
  var NULL = new ValuePromise(null);
  var UNDEFINED = new ValuePromise(undefined);
  var ZERO = new ValuePromise(0);
  var EMPTYSTRING = new ValuePromise('');
  Promise.resolve = function(value) {
    if (value instanceof Promise)
      return value;
    if (value === null)
      return NULL;
    if (value === undefined)
      return UNDEFINED;
    if (value === true)
      return TRUE;
    if (value === false)
      return FALSE;
    if (value === 0)
      return ZERO;
    if (value === '')
      return EMPTYSTRING;
    if (typeof value === 'object' || typeof value === 'function') {
      try {
        var then = value.then;
        if (typeof then === 'function') {
          return new Promise(then.bind(value));
        }
      } catch (ex) {
        return new Promise(function(resolve, reject) {
          reject(ex);
        });
      }
    }
    return new ValuePromise(value);
  };
  Promise.all = function(arr) {
    var args = Array.prototype.slice.call(arr);
    return new Promise(function(resolve, reject) {
      if (args.length === 0)
        return resolve([]);
      var remaining = args.length;
      function res(i, val) {
        try {
          if (val && (typeof val === 'object' || typeof val === 'function')) {
            var then = val.then;
            if (typeof then === 'function') {
              then.call(val, function(val) {
                res(i, val);
              }, reject);
              return ;
            }
          }
          args[i] = val;
          if (--remaining === 0) {
            resolve(args);
          }
        } catch (ex) {
          reject(ex);
        }
      }
      for (var i = 0; i < args.length; i++) {
        res(i, args[i]);
      }
    });
  };
  Promise.reject = function(value) {
    return new Promise(function(resolve, reject) {
      reject(value);
    });
  };
  Promise.race = function(values) {
    return new Promise(function(resolve, reject) {
      values.forEach(function(value) {
        Promise.resolve(value).then(resolve, reject);
      });
    });
  };
  Promise.prototype['catch'] = function(onRejected) {
    return this.then(null, onRejected);
  };
  global.define = __define;
  return module.exports;
});



System.register("npm:promise@6.1.0/lib/node-extensions", ["npm:promise@6.1.0/lib/core", "npm:asap@1.0.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var Promise = require("npm:promise@6.1.0/lib/core");
  var asap = require("npm:asap@1.0.0");
  module.exports = Promise;
  Promise.denodeify = function(fn, argumentCount) {
    argumentCount = argumentCount || Infinity;
    return function() {
      var self = this;
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function(resolve, reject) {
        while (args.length && args.length > argumentCount) {
          args.pop();
        }
        args.push(function(err, res) {
          if (err)
            reject(err);
          else
            resolve(res);
        });
        var res = fn.apply(self, args);
        if (res && (typeof res === 'object' || typeof res === 'function') && typeof res.then === 'function') {
          resolve(res);
        }
      });
    };
  };
  Promise.nodeify = function(fn) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      var ctx = this;
      try {
        return fn.apply(this, arguments).nodeify(callback, ctx);
      } catch (ex) {
        if (callback === null || typeof callback == 'undefined') {
          return new Promise(function(resolve, reject) {
            reject(ex);
          });
        } else {
          asap(function() {
            callback.call(ctx, ex);
          });
        }
      }
    };
  };
  Promise.prototype.nodeify = function(callback, ctx) {
    if (typeof callback != 'function')
      return this;
    this.then(function(value) {
      asap(function() {
        callback.call(ctx, null, value);
      });
    }, function(err) {
      asap(function() {
        callback.call(ctx, err);
      });
    });
  };
  global.define = __define;
  return module.exports;
});



(function() {
function define(){};  define.amd = {};
System.register("github:components/jquery@2.1.3", ["github:components/jquery@2.1.3/jquery"], false, function(__require, __exports, __module) {
  return (function(main) {
    return main;
  }).call(this, __require('github:components/jquery@2.1.3/jquery'));
});


})();
System.register("npm:process@0.10.0", ["npm:process@0.10.0/browser"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:process@0.10.0/browser");
  global.define = __define;
  return module.exports;
});



(function() {
function define(){};  define.amd = {};
System.register("github:Prinzhorn/skrollr@0.6.29", ["github:Prinzhorn/skrollr@0.6.29/skrollr"], false, function(__require, __exports, __module) {
  return (function(main) {
    return main;
  }).call(this, __require('github:Prinzhorn/skrollr@0.6.29/skrollr'));
});


})();
System.register("npm:slick-carousel@1.4.1", ["npm:slick-carousel@1.4.1/slick/slick"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:slick-carousel@1.4.1/slick/slick");
  global.define = __define;
  return module.exports;
});



System.register("app/form-buttons", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log", "app/check-breakpoint"], function (_export) {
	"use strict";

	var $, _, lg, isDesktop, $form_buttons;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}, function (_appCheckBreakpoint) {
			isDesktop = _appCheckBreakpoint.isDesktop;
		}],
		execute: function () {
			$form_buttons = $(".form-buttons").not(".force-height");
			// List containing radio or checkbox controls to be converted to buttons

			if ($form_buttons.length) {
				(function () {
					var conform_button_heights =

					// ------------------------------------
					// Check height of tallest button in each button group.
					// Make all buttons in that group same height.
					function () {
						if (isDesktop()) {
							$form_buttons.map(function (v, k) {
								var $num_buttons = $(k).find("label");
								var tallest_height = 0;
								$num_buttons.map(function (a, b) {
									var this_height = $(b).outerHeight();
									tallest_height = this_height > tallest_height ? this_height : tallest_height;
								});
								$num_buttons.css({ height: tallest_height });
							});
						} else {
							$form_buttons.map(function (v, k) {
								var $num_buttons = $(k).find("label");
								$num_buttons.css({ height: "auto" });
							});
						}
					};

					conform_button_heights();

					var debounce_conform_button_heights = _.debounce(conform_button_heights, 100);

					// Resize button heights on window resize
					$(window).on("resize", function () {
						debounce_conform_button_heights();
					});
				})();
			}

			lg("form buttons {blue{loaded}}");
		}
	};
});

// ====================================

System.register("npm:scriptjs@2.5.7", ["npm:scriptjs@2.5.7/dist/script"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:scriptjs@2.5.7/dist/script");
  global.define = __define;
  return module.exports;
});



System.register("npm:asap@1.0.0", ["npm:asap@1.0.0/asap"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:asap@1.0.0/asap");
  global.define = __define;
  return module.exports;
});



System.register("app/quick-log", ["github:components/jquery@2.1.3"], function (_export) {
	"use strict";
	function lg(x) {}
return {
		setters: [function (_githubComponentsJquery213) {
		}],
		execute: function () {
			_export("lg", lg);
		}
	};
});

// ====================================
// Quick and Dirty Debugging
//
// This is my quick way for printing things to the screen without having to open the inspector or
// have the inspector take up screen real estate. It's basically a better unintrusive "alert"
// meant for simple logging only.
//
// Text can be colored for easy scanning with the following colors:
//
// {red{ text }}
// {orange{ text }}
// {yellow{ text }}
// {green{ text }}
// {blue{ text }}
// {purple{ text }}
// {gray{ text }}
System.register("github:jspm/nodelibs-process@0.1.1/index", ["npm:process@0.10.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = System._nodeRequire ? process : require("npm:process@0.10.0");
  global.define = __define;
  return module.exports;
});



System.register("app/skrollr", ["github:components/jquery@2.1.3", "app/quick-log", "github:Prinzhorn/skrollr@0.6.29"], function (_export) {
	"use strict";

	var $, lg, s;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}, function (_githubPrinzhornSkrollr0629) {
			s = _githubPrinzhornSkrollr0629["default"];
		}],
		execute: function () {
			if ($(".scroll-motion").length) {
				lg("skrollr start");
				s.init();
			} else {
				lg("skrollr no start");
			}
			lg("skrollr {blue{loaded}}");
		}
	};
});

// ====================================
// skrollr
System.register("app/carousel", ["github:components/jquery@2.1.3", "npm:slick-carousel@1.4.1", "app/quick-log"], function (_export) {
	"use strict";

	var $, slick, lg, $slider;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmSlickCarousel141) {
			slick = _npmSlickCarousel141["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			$slider = $(".slider");
			// Sliders

			if ($slider.length) {
				(function () {
					var adjust_slider_height =

					// Clean up slider height
					// For an unknown reason, when slick.js pulls content into the carousel, it retains the "space" where the original content was of the height and width of that content.
					// This was fixed by specifying a height on the slider element (style="height"450px;), which is not ideal, but the only way I discovered that could fix this issue.
					// But setting a height on the slider created a new issue, that the height of content elements (such as class height450) is variable between mobile and desktop, and specifying a height directly on the elements causes it to be the same height on desktop and mobile.
					// So final solution is to check window resize and adjust the height with JavaScript.
					// None of this is ideal, of course, but after many many tests, this is the only solution I've found.
					function () {
						var height_adjustment = 0;
						$slider.find("section").map(function (v, k) {
							height_adjustment = $(k).outerHeight() > height_adjustment ? $(k).outerHeight() : height_adjustment;
						});
						//lg(`height_adjustment: ${height_adjustment}`);
						$slider.css({ height: height_adjustment });
					};

					$slider.map(function (v, k) {
						var dots = $(this).attr("data-slider-bullets") === "no" ? false : true,
						    arrows = $(this).attr("data-slider-arrows") === "no" ? false : true,
						    fade = $(this).attr("data-slider-fade") === "no" ? false : true,
						    slidesToShow = parseInt($(this).attr("data-slider-slidesToShow")),
						    slidesToScroll = parseInt($(this).attr("data-slider-slidesToScroll")),
						    autoplay = $(this).attr("data-slider-autoplay") === "no" ? false : true,
						    autoplaySpeed = parseInt($(this).attr("data-slider-autoplaySpeed")),
						    pauseOnHover = $(this).attr("data-slider-pauseOnHover") === "no" ? false : true;

						$(this).slick({
							dots: dots,
							infinite: true,
							speed: 500,
							slidesToShow: slidesToShow,
							slidesToScroll: slidesToScroll,
							arrows: arrows,
							fade: fade,
							autoplay: autoplay,
							autoplaySpeed: autoplaySpeed,
							pauseOnHover: pauseOnHover,
							responsive: [{
								breakpoint: 640,
								settings: {
									slidesToShow: 1 // At less than 640px, force only showing 1 slide at a time.
								}
							}]
						});
						adjust_slider_height();
					});

					$(window).on("resize", function () {
						adjust_slider_height();
					});
				})();
			}

			lg("carousel {blue{loaded}}");
		}
	};
});

// ====================================
// Carousel
// Using http://kenwheeler.github.io/slick/
System.register("npm:promise@6.1.0/lib/core", ["npm:asap@1.0.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var asap = require("npm:asap@1.0.0");
  module.exports = Promise;
  function Promise(fn) {
    if (typeof this !== 'object')
      throw new TypeError('Promises must be constructed via new');
    if (typeof fn !== 'function')
      throw new TypeError('not a function');
    var state = null;
    var value = null;
    var deferreds = [];
    var self = this;
    this.then = function(onFulfilled, onRejected) {
      return new self.constructor(function(resolve, reject) {
        handle(new Handler(onFulfilled, onRejected, resolve, reject));
      });
    };
    function handle(deferred) {
      if (state === null) {
        deferreds.push(deferred);
        return ;
      }
      asap(function() {
        var cb = state ? deferred.onFulfilled : deferred.onRejected;
        if (cb === null) {
          (state ? deferred.resolve : deferred.reject)(value);
          return ;
        }
        var ret;
        try {
          ret = cb(value);
        } catch (e) {
          deferred.reject(e);
          return ;
        }
        deferred.resolve(ret);
      });
    }
    function resolve(newValue) {
      try {
        if (newValue === self)
          throw new TypeError('A promise cannot be resolved with itself.');
        if (newValue && (typeof newValue === 'object' || typeof newValue === 'function')) {
          var then = newValue.then;
          if (typeof then === 'function') {
            doResolve(then.bind(newValue), resolve, reject);
            return ;
          }
        }
        state = true;
        value = newValue;
        finale();
      } catch (e) {
        reject(e);
      }
    }
    function reject(newValue) {
      state = false;
      value = newValue;
      finale();
    }
    function finale() {
      for (var i = 0,
          len = deferreds.length; i < len; i++)
        handle(deferreds[i]);
      deferreds = null;
    }
    doResolve(fn, resolve, reject);
  }
  function Handler(onFulfilled, onRejected, resolve, reject) {
    this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
    this.onRejected = typeof onRejected === 'function' ? onRejected : null;
    this.resolve = resolve;
    this.reject = reject;
  }
  function doResolve(fn, onFulfilled, onRejected) {
    var done = false;
    try {
      fn(function(value) {
        if (done)
          return ;
        done = true;
        onFulfilled(value);
      }, function(reason) {
        if (done)
          return ;
        done = true;
        onRejected(reason);
      });
    } catch (ex) {
      if (done)
        return ;
      done = true;
      onRejected(ex);
    }
  }
  global.define = __define;
  return module.exports;
});



System.register("github:jspm/nodelibs-process@0.1.1", ["github:jspm/nodelibs-process@0.1.1/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("github:jspm/nodelibs-process@0.1.1/index");
  global.define = __define;
  return module.exports;
});



System.register("npm:promise@6.1.0/index", ["npm:promise@6.1.0/lib/core", "npm:promise@6.1.0/lib/done", "npm:promise@6.1.0/lib/es6-extensions", "npm:promise@6.1.0/lib/node-extensions"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  'use strict';
  module.exports = require("npm:promise@6.1.0/lib/core");
  require("npm:promise@6.1.0/lib/done");
  require("npm:promise@6.1.0/lib/es6-extensions");
  require("npm:promise@6.1.0/lib/node-extensions");
  global.define = __define;
  return module.exports;
});



System.register("npm:lodash@3.2.0/index", ["github:jspm/nodelibs-process@0.1.1"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(process) {
    ;
    (function() {
      var undefined;
      var VERSION = '3.2.0';
      var BIND_FLAG = 1,
          BIND_KEY_FLAG = 2,
          CURRY_BOUND_FLAG = 4,
          CURRY_FLAG = 8,
          CURRY_RIGHT_FLAG = 16,
          PARTIAL_FLAG = 32,
          PARTIAL_RIGHT_FLAG = 64,
          REARG_FLAG = 128,
          ARY_FLAG = 256;
      var DEFAULT_TRUNC_LENGTH = 30,
          DEFAULT_TRUNC_OMISSION = '...';
      var HOT_COUNT = 150,
          HOT_SPAN = 16;
      var LAZY_FILTER_FLAG = 0,
          LAZY_MAP_FLAG = 1,
          LAZY_WHILE_FLAG = 2;
      var FUNC_ERROR_TEXT = 'Expected a function';
      var PLACEHOLDER = '__lodash_placeholder__';
      var argsTag = '[object Arguments]',
          arrayTag = '[object Array]',
          boolTag = '[object Boolean]',
          dateTag = '[object Date]',
          errorTag = '[object Error]',
          funcTag = '[object Function]',
          mapTag = '[object Map]',
          numberTag = '[object Number]',
          objectTag = '[object Object]',
          regexpTag = '[object RegExp]',
          setTag = '[object Set]',
          stringTag = '[object String]',
          weakMapTag = '[object WeakMap]';
      var arrayBufferTag = '[object ArrayBuffer]',
          float32Tag = '[object Float32Array]',
          float64Tag = '[object Float64Array]',
          int8Tag = '[object Int8Array]',
          int16Tag = '[object Int16Array]',
          int32Tag = '[object Int32Array]',
          uint8Tag = '[object Uint8Array]',
          uint8ClampedTag = '[object Uint8ClampedArray]',
          uint16Tag = '[object Uint16Array]',
          uint32Tag = '[object Uint32Array]';
      var reEmptyStringLeading = /\b__p \+= '';/g,
          reEmptyStringMiddle = /\b(__p \+=) '' \+/g,
          reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;
      var reEscapedHtml = /&(?:amp|lt|gt|quot|#39|#96);/g,
          reUnescapedHtml = /[&<>"'`]/g,
          reHasEscapedHtml = RegExp(reEscapedHtml.source),
          reHasUnescapedHtml = RegExp(reUnescapedHtml.source);
      var reEscape = /<%-([\s\S]+?)%>/g,
          reEvaluate = /<%([\s\S]+?)%>/g,
          reInterpolate = /<%=([\s\S]+?)%>/g;
      var reEsTemplate = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;
      var reFlags = /\w*$/;
      var reFuncName = /^\s*function[ \n\r\t]+\w/;
      var reHexPrefix = /^0[xX]/;
      var reHostCtor = /^\[object .+?Constructor\]$/;
      var reLatin1 = /[\xc0-\xd6\xd8-\xde\xdf-\xf6\xf8-\xff]/g;
      var reNoMatch = /($^)/;
      var reRegExpChars = /[.*+?^${}()|[\]\/\\]/g,
          reHasRegExpChars = RegExp(reRegExpChars.source);
      var reThis = /\bthis\b/;
      var reUnescapedString = /['\n\r\u2028\u2029\\]/g;
      var reWords = (function() {
        var upper = '[A-Z\\xc0-\\xd6\\xd8-\\xde]',
            lower = '[a-z\\xdf-\\xf6\\xf8-\\xff]+';
        return RegExp(upper + '{2,}(?=' + upper + lower + ')|' + upper + '?' + lower + '|' + upper + '+|[0-9]+', 'g');
      }());
      var whitespace = (' \t\x0b\f\xa0\ufeff' + '\n\r\u2028\u2029' + '\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000');
      var contextProps = ['Array', 'ArrayBuffer', 'Date', 'Error', 'Float32Array', 'Float64Array', 'Function', 'Int8Array', 'Int16Array', 'Int32Array', 'Math', 'Number', 'Object', 'RegExp', 'Set', 'String', '_', 'clearTimeout', 'document', 'isFinite', 'parseInt', 'setTimeout', 'TypeError', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'WeakMap', 'window', 'WinRTError'];
      var templateCounter = -1;
      var typedArrayTags = {};
      typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
      typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
      var cloneableTags = {};
      cloneableTags[argsTag] = cloneableTags[arrayTag] = cloneableTags[arrayBufferTag] = cloneableTags[boolTag] = cloneableTags[dateTag] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[numberTag] = cloneableTags[objectTag] = cloneableTags[regexpTag] = cloneableTags[stringTag] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
      cloneableTags[errorTag] = cloneableTags[funcTag] = cloneableTags[mapTag] = cloneableTags[setTag] = cloneableTags[weakMapTag] = false;
      var debounceOptions = {
        'leading': false,
        'maxWait': 0,
        'trailing': false
      };
      var deburredLetters = {
        '\xc0': 'A',
        '\xc1': 'A',
        '\xc2': 'A',
        '\xc3': 'A',
        '\xc4': 'A',
        '\xc5': 'A',
        '\xe0': 'a',
        '\xe1': 'a',
        '\xe2': 'a',
        '\xe3': 'a',
        '\xe4': 'a',
        '\xe5': 'a',
        '\xc7': 'C',
        '\xe7': 'c',
        '\xd0': 'D',
        '\xf0': 'd',
        '\xc8': 'E',
        '\xc9': 'E',
        '\xca': 'E',
        '\xcb': 'E',
        '\xe8': 'e',
        '\xe9': 'e',
        '\xea': 'e',
        '\xeb': 'e',
        '\xcC': 'I',
        '\xcd': 'I',
        '\xce': 'I',
        '\xcf': 'I',
        '\xeC': 'i',
        '\xed': 'i',
        '\xee': 'i',
        '\xef': 'i',
        '\xd1': 'N',
        '\xf1': 'n',
        '\xd2': 'O',
        '\xd3': 'O',
        '\xd4': 'O',
        '\xd5': 'O',
        '\xd6': 'O',
        '\xd8': 'O',
        '\xf2': 'o',
        '\xf3': 'o',
        '\xf4': 'o',
        '\xf5': 'o',
        '\xf6': 'o',
        '\xf8': 'o',
        '\xd9': 'U',
        '\xda': 'U',
        '\xdb': 'U',
        '\xdc': 'U',
        '\xf9': 'u',
        '\xfa': 'u',
        '\xfb': 'u',
        '\xfc': 'u',
        '\xdd': 'Y',
        '\xfd': 'y',
        '\xff': 'y',
        '\xc6': 'Ae',
        '\xe6': 'ae',
        '\xde': 'Th',
        '\xfe': 'th',
        '\xdf': 'ss'
      };
      var htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;'
      };
      var htmlUnescapes = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&#96;': '`'
      };
      var objectTypes = {
        'function': true,
        'object': true
      };
      var stringEscapes = {
        '\\': '\\',
        "'": "'",
        '\n': 'n',
        '\r': 'r',
        '\u2028': 'u2028',
        '\u2029': 'u2029'
      };
      var root = (objectTypes[typeof window] && window !== (this && this.window)) ? window : this;
      var freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports;
      var freeModule = objectTypes[typeof module] && module && !module.nodeType && module;
      var freeGlobal = freeExports && freeModule && typeof global == 'object' && global;
      if (freeGlobal && (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal || freeGlobal.self === freeGlobal)) {
        root = freeGlobal;
      }
      var moduleExports = freeModule && freeModule.exports === freeExports && freeExports;
      function baseCompareAscending(value, other) {
        if (value !== other) {
          var valIsReflexive = value === value,
              othIsReflexive = other === other;
          if (value > other || !valIsReflexive || (typeof value == 'undefined' && othIsReflexive)) {
            return 1;
          }
          if (value < other || !othIsReflexive || (typeof other == 'undefined' && valIsReflexive)) {
            return -1;
          }
        }
        return 0;
      }
      function baseIndexOf(array, value, fromIndex) {
        if (value !== value) {
          return indexOfNaN(array, fromIndex);
        }
        var index = (fromIndex || 0) - 1,
            length = array.length;
        while (++index < length) {
          if (array[index] === value) {
            return index;
          }
        }
        return -1;
      }
      function baseSortBy(array, comparer) {
        var length = array.length;
        array.sort(comparer);
        while (length--) {
          array[length] = array[length].value;
        }
        return array;
      }
      function baseToString(value) {
        if (typeof value == 'string') {
          return value;
        }
        return value == null ? '' : (value + '');
      }
      function charAtCallback(string) {
        return string.charCodeAt(0);
      }
      function charsLeftIndex(string, chars) {
        var index = -1,
            length = string.length;
        while (++index < length && chars.indexOf(string.charAt(index)) > -1) {}
        return index;
      }
      function charsRightIndex(string, chars) {
        var index = string.length;
        while (index-- && chars.indexOf(string.charAt(index)) > -1) {}
        return index;
      }
      function compareAscending(object, other) {
        return baseCompareAscending(object.criteria, other.criteria) || (object.index - other.index);
      }
      function compareMultipleAscending(object, other) {
        var index = -1,
            objCriteria = object.criteria,
            othCriteria = other.criteria,
            length = objCriteria.length;
        while (++index < length) {
          var result = baseCompareAscending(objCriteria[index], othCriteria[index]);
          if (result) {
            return result;
          }
        }
        return object.index - other.index;
      }
      function deburrLetter(letter) {
        return deburredLetters[letter];
      }
      function escapeHtmlChar(chr) {
        return htmlEscapes[chr];
      }
      function escapeStringChar(chr) {
        return '\\' + stringEscapes[chr];
      }
      function indexOfNaN(array, fromIndex, fromRight) {
        var length = array.length,
            index = fromRight ? (fromIndex || length) : ((fromIndex || 0) - 1);
        while ((fromRight ? index-- : ++index < length)) {
          var other = array[index];
          if (other !== other) {
            return index;
          }
        }
        return -1;
      }
      function isObjectLike(value) {
        return (value && typeof value == 'object') || false;
      }
      function isSpace(charCode) {
        return ((charCode <= 160 && (charCode >= 9 && charCode <= 13) || charCode == 32 || charCode == 160) || charCode == 5760 || charCode == 6158 || (charCode >= 8192 && (charCode <= 8202 || charCode == 8232 || charCode == 8233 || charCode == 8239 || charCode == 8287 || charCode == 12288 || charCode == 65279)));
      }
      function replaceHolders(array, placeholder) {
        var index = -1,
            length = array.length,
            resIndex = -1,
            result = [];
        while (++index < length) {
          if (array[index] === placeholder) {
            array[index] = PLACEHOLDER;
            result[++resIndex] = index;
          }
        }
        return result;
      }
      function sortedUniq(array, iteratee) {
        var seen,
            index = -1,
            length = array.length,
            resIndex = -1,
            result = [];
        while (++index < length) {
          var value = array[index],
              computed = iteratee ? iteratee(value, index, array) : value;
          if (!index || seen !== computed) {
            seen = computed;
            result[++resIndex] = value;
          }
        }
        return result;
      }
      function trimmedLeftIndex(string) {
        var index = -1,
            length = string.length;
        while (++index < length && isSpace(string.charCodeAt(index))) {}
        return index;
      }
      function trimmedRightIndex(string) {
        var index = string.length;
        while (index-- && isSpace(string.charCodeAt(index))) {}
        return index;
      }
      function unescapeHtmlChar(chr) {
        return htmlUnescapes[chr];
      }
      function runInContext(context) {
        context = context ? _.defaults(root.Object(), context, _.pick(root, contextProps)) : root;
        var Array = context.Array,
            Date = context.Date,
            Error = context.Error,
            Function = context.Function,
            Math = context.Math,
            Number = context.Number,
            Object = context.Object,
            RegExp = context.RegExp,
            String = context.String,
            TypeError = context.TypeError;
        var arrayProto = Array.prototype,
            objectProto = Object.prototype;
        var document = (document = context.window) && document.document;
        var fnToString = Function.prototype.toString;
        var getLength = baseProperty('length');
        var hasOwnProperty = objectProto.hasOwnProperty;
        var idCounter = 0;
        var objToString = objectProto.toString;
        var oldDash = context._;
        var reNative = RegExp('^' + escapeRegExp(objToString).replace(/toString|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$');
        var ArrayBuffer = isNative(ArrayBuffer = context.ArrayBuffer) && ArrayBuffer,
            bufferSlice = isNative(bufferSlice = ArrayBuffer && new ArrayBuffer(0).slice) && bufferSlice,
            ceil = Math.ceil,
            clearTimeout = context.clearTimeout,
            floor = Math.floor,
            getPrototypeOf = isNative(getPrototypeOf = Object.getPrototypeOf) && getPrototypeOf,
            push = arrayProto.push,
            propertyIsEnumerable = objectProto.propertyIsEnumerable,
            Set = isNative(Set = context.Set) && Set,
            setTimeout = context.setTimeout,
            splice = arrayProto.splice,
            Uint8Array = isNative(Uint8Array = context.Uint8Array) && Uint8Array,
            WeakMap = isNative(WeakMap = context.WeakMap) && WeakMap;
        var Float64Array = (function() {
          try {
            var func = isNative(func = context.Float64Array) && func,
                result = new func(new ArrayBuffer(10), 0, 1) && func;
          } catch (e) {}
          return result;
        }());
        var nativeIsArray = isNative(nativeIsArray = Array.isArray) && nativeIsArray,
            nativeCreate = isNative(nativeCreate = Object.create) && nativeCreate,
            nativeIsFinite = context.isFinite,
            nativeKeys = isNative(nativeKeys = Object.keys) && nativeKeys,
            nativeMax = Math.max,
            nativeMin = Math.min,
            nativeNow = isNative(nativeNow = Date.now) && nativeNow,
            nativeNumIsFinite = isNative(nativeNumIsFinite = Number.isFinite) && nativeNumIsFinite,
            nativeParseInt = context.parseInt,
            nativeRandom = Math.random;
        var NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY,
            POSITIVE_INFINITY = Number.POSITIVE_INFINITY;
        var MAX_ARRAY_LENGTH = Math.pow(2, 32) - 1,
            MAX_ARRAY_INDEX = MAX_ARRAY_LENGTH - 1,
            HALF_MAX_ARRAY_LENGTH = MAX_ARRAY_LENGTH >>> 1;
        var FLOAT64_BYTES_PER_ELEMENT = Float64Array ? Float64Array.BYTES_PER_ELEMENT : 0;
        var MAX_SAFE_INTEGER = Math.pow(2, 53) - 1;
        var metaMap = WeakMap && new WeakMap;
        function lodash(value) {
          if (isObjectLike(value) && !isArray(value) && !(value instanceof LazyWrapper)) {
            if (value instanceof LodashWrapper) {
              return value;
            }
            if (hasOwnProperty.call(value, '__chain__') && hasOwnProperty.call(value, '__wrapped__')) {
              return wrapperClone(value);
            }
          }
          return new LodashWrapper(value);
        }
        function LodashWrapper(value, chainAll, actions) {
          this.__wrapped__ = value;
          this.__actions__ = actions || [];
          this.__chain__ = !!chainAll;
        }
        var support = lodash.support = {};
        (function(x) {
          support.funcDecomp = !isNative(context.WinRTError) && reThis.test(runInContext);
          support.funcNames = typeof Function.name == 'string';
          try {
            support.dom = document.createDocumentFragment().nodeType === 11;
          } catch (e) {
            support.dom = false;
          }
          try {
            support.nonEnumArgs = !propertyIsEnumerable.call(arguments, 1);
          } catch (e) {
            support.nonEnumArgs = true;
          }
        }(0, 0));
        lodash.templateSettings = {
          'escape': reEscape,
          'evaluate': reEvaluate,
          'interpolate': reInterpolate,
          'variable': '',
          'imports': {'_': lodash}
        };
        function LazyWrapper(value) {
          this.__wrapped__ = value;
          this.__actions__ = null;
          this.__dir__ = 1;
          this.__dropCount__ = 0;
          this.__filtered__ = false;
          this.__iteratees__ = null;
          this.__takeCount__ = POSITIVE_INFINITY;
          this.__views__ = null;
        }
        function lazyClone() {
          var actions = this.__actions__,
              iteratees = this.__iteratees__,
              views = this.__views__,
              result = new LazyWrapper(this.__wrapped__);
          result.__actions__ = actions ? arrayCopy(actions) : null;
          result.__dir__ = this.__dir__;
          result.__dropCount__ = this.__dropCount__;
          result.__filtered__ = this.__filtered__;
          result.__iteratees__ = iteratees ? arrayCopy(iteratees) : null;
          result.__takeCount__ = this.__takeCount__;
          result.__views__ = views ? arrayCopy(views) : null;
          return result;
        }
        function lazyReverse() {
          if (this.__filtered__) {
            var result = new LazyWrapper(this);
            result.__dir__ = -1;
            result.__filtered__ = true;
          } else {
            result = this.clone();
            result.__dir__ *= -1;
          }
          return result;
        }
        function lazyValue() {
          var array = this.__wrapped__.value();
          if (!isArray(array)) {
            return baseWrapperValue(array, this.__actions__);
          }
          var dir = this.__dir__,
              isRight = dir < 0,
              view = getView(0, array.length, this.__views__),
              start = view.start,
              end = view.end,
              length = end - start,
              dropCount = this.__dropCount__,
              takeCount = nativeMin(length, this.__takeCount__),
              index = isRight ? end : start - 1,
              iteratees = this.__iteratees__,
              iterLength = iteratees ? iteratees.length : 0,
              resIndex = 0,
              result = [];
          outer: while (length-- && resIndex < takeCount) {
            index += dir;
            var iterIndex = -1,
                value = array[index];
            while (++iterIndex < iterLength) {
              var data = iteratees[iterIndex],
                  iteratee = data.iteratee,
                  computed = iteratee(value, index, array),
                  type = data.type;
              if (type == LAZY_MAP_FLAG) {
                value = computed;
              } else if (!computed) {
                if (type == LAZY_FILTER_FLAG) {
                  continue outer;
                } else {
                  break outer;
                }
              }
            }
            if (dropCount) {
              dropCount--;
            } else {
              result[resIndex++] = value;
            }
          }
          return result;
        }
        function MapCache() {
          this.__data__ = {};
        }
        function mapDelete(key) {
          return this.has(key) && delete this.__data__[key];
        }
        function mapGet(key) {
          return key == '__proto__' ? undefined : this.__data__[key];
        }
        function mapHas(key) {
          return key != '__proto__' && hasOwnProperty.call(this.__data__, key);
        }
        function mapSet(key, value) {
          if (key != '__proto__') {
            this.__data__[key] = value;
          }
          return this;
        }
        function SetCache(values) {
          var length = values ? values.length : 0;
          this.data = {
            'hash': nativeCreate(null),
            'set': new Set
          };
          while (length--) {
            this.push(values[length]);
          }
        }
        function cacheIndexOf(cache, value) {
          var data = cache.data,
              result = (typeof value == 'string' || isObject(value)) ? data.set.has(value) : data.hash[value];
          return result ? 0 : -1;
        }
        function cachePush(value) {
          var data = this.data;
          if (typeof value == 'string' || isObject(value)) {
            data.set.add(value);
          } else {
            data.hash[value] = true;
          }
        }
        function arrayCopy(source, array) {
          var index = -1,
              length = source.length;
          array || (array = Array(length));
          while (++index < length) {
            array[index] = source[index];
          }
          return array;
        }
        function arrayEach(array, iteratee) {
          var index = -1,
              length = array.length;
          while (++index < length) {
            if (iteratee(array[index], index, array) === false) {
              break;
            }
          }
          return array;
        }
        function arrayEachRight(array, iteratee) {
          var length = array.length;
          while (length--) {
            if (iteratee(array[length], length, array) === false) {
              break;
            }
          }
          return array;
        }
        function arrayEvery(array, predicate) {
          var index = -1,
              length = array.length;
          while (++index < length) {
            if (!predicate(array[index], index, array)) {
              return false;
            }
          }
          return true;
        }
        function arrayFilter(array, predicate) {
          var index = -1,
              length = array.length,
              resIndex = -1,
              result = [];
          while (++index < length) {
            var value = array[index];
            if (predicate(value, index, array)) {
              result[++resIndex] = value;
            }
          }
          return result;
        }
        function arrayMap(array, iteratee) {
          var index = -1,
              length = array.length,
              result = Array(length);
          while (++index < length) {
            result[index] = iteratee(array[index], index, array);
          }
          return result;
        }
        function arrayMax(array) {
          var index = -1,
              length = array.length,
              result = NEGATIVE_INFINITY;
          while (++index < length) {
            var value = array[index];
            if (value > result) {
              result = value;
            }
          }
          return result;
        }
        function arrayMin(array) {
          var index = -1,
              length = array.length,
              result = POSITIVE_INFINITY;
          while (++index < length) {
            var value = array[index];
            if (value < result) {
              result = value;
            }
          }
          return result;
        }
        function arrayReduce(array, iteratee, accumulator, initFromArray) {
          var index = -1,
              length = array.length;
          if (initFromArray && length) {
            accumulator = array[++index];
          }
          while (++index < length) {
            accumulator = iteratee(accumulator, array[index], index, array);
          }
          return accumulator;
        }
        function arrayReduceRight(array, iteratee, accumulator, initFromArray) {
          var length = array.length;
          if (initFromArray && length) {
            accumulator = array[--length];
          }
          while (length--) {
            accumulator = iteratee(accumulator, array[length], length, array);
          }
          return accumulator;
        }
        function arraySome(array, predicate) {
          var index = -1,
              length = array.length;
          while (++index < length) {
            if (predicate(array[index], index, array)) {
              return true;
            }
          }
          return false;
        }
        function assignDefaults(objectValue, sourceValue) {
          return typeof objectValue == 'undefined' ? sourceValue : objectValue;
        }
        function assignOwnDefaults(objectValue, sourceValue, key, object) {
          return (typeof objectValue == 'undefined' || !hasOwnProperty.call(object, key)) ? sourceValue : objectValue;
        }
        function baseAssign(object, source, customizer) {
          var props = keys(source);
          if (!customizer) {
            return baseCopy(source, object, props);
          }
          var index = -1,
              length = props.length;
          while (++index < length) {
            var key = props[index],
                value = object[key],
                result = customizer(value, source[key], key, object, source);
            if ((result === result ? result !== value : value === value) || (typeof value == 'undefined' && !(key in object))) {
              object[key] = result;
            }
          }
          return object;
        }
        function baseAt(collection, props) {
          var index = -1,
              length = collection.length,
              isArr = isLength(length),
              propsLength = props.length,
              result = Array(propsLength);
          while (++index < propsLength) {
            var key = props[index];
            if (isArr) {
              key = parseFloat(key);
              result[index] = isIndex(key, length) ? collection[key] : undefined;
            } else {
              result[index] = collection[key];
            }
          }
          return result;
        }
        function baseCopy(source, object, props) {
          if (!props) {
            props = object;
            object = {};
          }
          var index = -1,
              length = props.length;
          while (++index < length) {
            var key = props[index];
            object[key] = source[key];
          }
          return object;
        }
        function baseBindAll(object, methodNames) {
          var index = -1,
              length = methodNames.length;
          while (++index < length) {
            var key = methodNames[index];
            object[key] = createWrapper(object[key], BIND_FLAG, object);
          }
          return object;
        }
        function baseCallback(func, thisArg, argCount) {
          var type = typeof func;
          if (type == 'function') {
            return (typeof thisArg != 'undefined' && isBindable(func)) ? bindCallback(func, thisArg, argCount) : func;
          }
          if (func == null) {
            return identity;
          }
          if (type == 'object') {
            return baseMatches(func);
          }
          return typeof thisArg == 'undefined' ? baseProperty(func + '') : baseMatchesProperty(func + '', thisArg);
        }
        function baseClone(value, isDeep, customizer, key, object, stackA, stackB) {
          var result;
          if (customizer) {
            result = object ? customizer(value, key, object) : customizer(value);
          }
          if (typeof result != 'undefined') {
            return result;
          }
          if (!isObject(value)) {
            return value;
          }
          var isArr = isArray(value);
          if (isArr) {
            result = initCloneArray(value);
            if (!isDeep) {
              return arrayCopy(value, result);
            }
          } else {
            var tag = objToString.call(value),
                isFunc = tag == funcTag;
            if (tag == objectTag || tag == argsTag || (isFunc && !object)) {
              result = initCloneObject(isFunc ? {} : value);
              if (!isDeep) {
                return baseCopy(value, result, keys(value));
              }
            } else {
              return cloneableTags[tag] ? initCloneByTag(value, tag, isDeep) : (object ? value : {});
            }
          }
          stackA || (stackA = []);
          stackB || (stackB = []);
          var length = stackA.length;
          while (length--) {
            if (stackA[length] == value) {
              return stackB[length];
            }
          }
          stackA.push(value);
          stackB.push(result);
          (isArr ? arrayEach : baseForOwn)(value, function(subValue, key) {
            result[key] = baseClone(subValue, isDeep, customizer, key, value, stackA, stackB);
          });
          return result;
        }
        var baseCreate = (function() {
          function Object() {}
          return function(prototype) {
            if (isObject(prototype)) {
              Object.prototype = prototype;
              var result = new Object;
              Object.prototype = null;
            }
            return result || context.Object();
          };
        }());
        function baseDelay(func, wait, args, fromIndex) {
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return setTimeout(function() {
            func.apply(undefined, baseSlice(args, fromIndex));
          }, wait);
        }
        function baseDifference(array, values) {
          var length = array ? array.length : 0,
              result = [];
          if (!length) {
            return result;
          }
          var index = -1,
              indexOf = getIndexOf(),
              isCommon = indexOf == baseIndexOf,
              cache = isCommon && values.length >= 200 && createCache(values),
              valuesLength = values.length;
          if (cache) {
            indexOf = cacheIndexOf;
            isCommon = false;
            values = cache;
          }
          outer: while (++index < length) {
            var value = array[index];
            if (isCommon && value === value) {
              var valuesIndex = valuesLength;
              while (valuesIndex--) {
                if (values[valuesIndex] === value) {
                  continue outer;
                }
              }
              result.push(value);
            } else if (indexOf(values, value) < 0) {
              result.push(value);
            }
          }
          return result;
        }
        function baseEach(collection, iteratee) {
          var length = collection ? collection.length : 0;
          if (!isLength(length)) {
            return baseForOwn(collection, iteratee);
          }
          var index = -1,
              iterable = toObject(collection);
          while (++index < length) {
            if (iteratee(iterable[index], index, iterable) === false) {
              break;
            }
          }
          return collection;
        }
        function baseEachRight(collection, iteratee) {
          var length = collection ? collection.length : 0;
          if (!isLength(length)) {
            return baseForOwnRight(collection, iteratee);
          }
          var iterable = toObject(collection);
          while (length--) {
            if (iteratee(iterable[length], length, iterable) === false) {
              break;
            }
          }
          return collection;
        }
        function baseEvery(collection, predicate) {
          var result = true;
          baseEach(collection, function(value, index, collection) {
            result = !!predicate(value, index, collection);
            return result;
          });
          return result;
        }
        function baseFill(array, value, start, end) {
          var length = array.length;
          start = start == null ? 0 : (+start || 0);
          if (start < 0) {
            start = -start > length ? 0 : (length + start);
          }
          end = (typeof end == 'undefined' || end > length) ? length : (+end || 0);
          if (end < 0) {
            end += length;
          }
          length = start > end ? 0 : end >>> 0;
          start >>>= 0;
          while (start < length) {
            array[start++] = value;
          }
          return array;
        }
        function baseFilter(collection, predicate) {
          var result = [];
          baseEach(collection, function(value, index, collection) {
            if (predicate(value, index, collection)) {
              result.push(value);
            }
          });
          return result;
        }
        function baseFind(collection, predicate, eachFunc, retKey) {
          var result;
          eachFunc(collection, function(value, key, collection) {
            if (predicate(value, key, collection)) {
              result = retKey ? key : value;
              return false;
            }
          });
          return result;
        }
        function baseFlatten(array, isDeep, isStrict, fromIndex) {
          var index = (fromIndex || 0) - 1,
              length = array.length,
              resIndex = -1,
              result = [];
          while (++index < length) {
            var value = array[index];
            if (isObjectLike(value) && isLength(value.length) && (isArray(value) || isArguments(value))) {
              if (isDeep) {
                value = baseFlatten(value, isDeep, isStrict);
              }
              var valIndex = -1,
                  valLength = value.length;
              result.length += valLength;
              while (++valIndex < valLength) {
                result[++resIndex] = value[valIndex];
              }
            } else if (!isStrict) {
              result[++resIndex] = value;
            }
          }
          return result;
        }
        function baseFor(object, iteratee, keysFunc) {
          var index = -1,
              iterable = toObject(object),
              props = keysFunc(object),
              length = props.length;
          while (++index < length) {
            var key = props[index];
            if (iteratee(iterable[key], key, iterable) === false) {
              break;
            }
          }
          return object;
        }
        function baseForRight(object, iteratee, keysFunc) {
          var iterable = toObject(object),
              props = keysFunc(object),
              length = props.length;
          while (length--) {
            var key = props[length];
            if (iteratee(iterable[key], key, iterable) === false) {
              break;
            }
          }
          return object;
        }
        function baseForIn(object, iteratee) {
          return baseFor(object, iteratee, keysIn);
        }
        function baseForOwn(object, iteratee) {
          return baseFor(object, iteratee, keys);
        }
        function baseForOwnRight(object, iteratee) {
          return baseForRight(object, iteratee, keys);
        }
        function baseFunctions(object, props) {
          var index = -1,
              length = props.length,
              resIndex = -1,
              result = [];
          while (++index < length) {
            var key = props[index];
            if (isFunction(object[key])) {
              result[++resIndex] = key;
            }
          }
          return result;
        }
        function baseInvoke(collection, methodName, args) {
          var index = -1,
              isFunc = typeof methodName == 'function',
              length = collection ? collection.length : 0,
              result = isLength(length) ? Array(length) : [];
          baseEach(collection, function(value) {
            var func = isFunc ? methodName : (value != null && value[methodName]);
            result[++index] = func ? func.apply(value, args) : undefined;
          });
          return result;
        }
        function baseIsEqual(value, other, customizer, isWhere, stackA, stackB) {
          if (value === other) {
            return value !== 0 || (1 / value == 1 / other);
          }
          var valType = typeof value,
              othType = typeof other;
          if ((valType != 'function' && valType != 'object' && othType != 'function' && othType != 'object') || value == null || other == null) {
            return value !== value && other !== other;
          }
          return baseIsEqualDeep(value, other, baseIsEqual, customizer, isWhere, stackA, stackB);
        }
        function baseIsEqualDeep(object, other, equalFunc, customizer, isWhere, stackA, stackB) {
          var objIsArr = isArray(object),
              othIsArr = isArray(other),
              objTag = arrayTag,
              othTag = arrayTag;
          if (!objIsArr) {
            objTag = objToString.call(object);
            if (objTag == argsTag) {
              objTag = objectTag;
            } else if (objTag != objectTag) {
              objIsArr = isTypedArray(object);
            }
          }
          if (!othIsArr) {
            othTag = objToString.call(other);
            if (othTag == argsTag) {
              othTag = objectTag;
            } else if (othTag != objectTag) {
              othIsArr = isTypedArray(other);
            }
          }
          var objIsObj = objTag == objectTag,
              othIsObj = othTag == objectTag,
              isSameTag = objTag == othTag;
          if (isSameTag && !(objIsArr || objIsObj)) {
            return equalByTag(object, other, objTag);
          }
          var valWrapped = objIsObj && hasOwnProperty.call(object, '__wrapped__'),
              othWrapped = othIsObj && hasOwnProperty.call(other, '__wrapped__');
          if (valWrapped || othWrapped) {
            return equalFunc(valWrapped ? object.value() : object, othWrapped ? other.value() : other, customizer, isWhere, stackA, stackB);
          }
          if (!isSameTag) {
            return false;
          }
          stackA || (stackA = []);
          stackB || (stackB = []);
          var length = stackA.length;
          while (length--) {
            if (stackA[length] == object) {
              return stackB[length] == other;
            }
          }
          stackA.push(object);
          stackB.push(other);
          var result = (objIsArr ? equalArrays : equalObjects)(object, other, equalFunc, customizer, isWhere, stackA, stackB);
          stackA.pop();
          stackB.pop();
          return result;
        }
        function baseIsMatch(object, props, values, strictCompareFlags, customizer) {
          var length = props.length;
          if (object == null) {
            return !length;
          }
          var index = -1,
              noCustomizer = !customizer;
          while (++index < length) {
            if ((noCustomizer && strictCompareFlags[index]) ? values[index] !== object[props[index]] : !hasOwnProperty.call(object, props[index])) {
              return false;
            }
          }
          index = -1;
          while (++index < length) {
            var key = props[index];
            if (noCustomizer && strictCompareFlags[index]) {
              var result = hasOwnProperty.call(object, key);
            } else {
              var objValue = object[key],
                  srcValue = values[index];
              result = customizer ? customizer(objValue, srcValue, key) : undefined;
              if (typeof result == 'undefined') {
                result = baseIsEqual(srcValue, objValue, customizer, true);
              }
            }
            if (!result) {
              return false;
            }
          }
          return true;
        }
        function baseMap(collection, iteratee) {
          var result = [];
          baseEach(collection, function(value, key, collection) {
            result.push(iteratee(value, key, collection));
          });
          return result;
        }
        function baseMatches(source) {
          var props = keys(source),
              length = props.length;
          if (length == 1) {
            var key = props[0],
                value = source[key];
            if (isStrictComparable(value)) {
              return function(object) {
                return object != null && value === object[key] && hasOwnProperty.call(object, key);
              };
            }
          }
          var values = Array(length),
              strictCompareFlags = Array(length);
          while (length--) {
            value = source[props[length]];
            values[length] = value;
            strictCompareFlags[length] = isStrictComparable(value);
          }
          return function(object) {
            return baseIsMatch(object, props, values, strictCompareFlags);
          };
        }
        function baseMatchesProperty(key, value) {
          if (isStrictComparable(value)) {
            return function(object) {
              return object != null && object[key] === value;
            };
          }
          return function(object) {
            return object != null && baseIsEqual(value, object[key], null, true);
          };
        }
        function baseMerge(object, source, customizer, stackA, stackB) {
          var isSrcArr = isLength(source.length) && (isArray(source) || isTypedArray(source));
          (isSrcArr ? arrayEach : baseForOwn)(source, function(srcValue, key, source) {
            if (isObjectLike(srcValue)) {
              stackA || (stackA = []);
              stackB || (stackB = []);
              return baseMergeDeep(object, source, key, baseMerge, customizer, stackA, stackB);
            }
            var value = object[key],
                result = customizer ? customizer(value, srcValue, key, object, source) : undefined,
                isCommon = typeof result == 'undefined';
            if (isCommon) {
              result = srcValue;
            }
            if ((isSrcArr || typeof result != 'undefined') && (isCommon || (result === result ? result !== value : value === value))) {
              object[key] = result;
            }
          });
          return object;
        }
        function baseMergeDeep(object, source, key, mergeFunc, customizer, stackA, stackB) {
          var length = stackA.length,
              srcValue = source[key];
          while (length--) {
            if (stackA[length] == srcValue) {
              object[key] = stackB[length];
              return ;
            }
          }
          var value = object[key],
              result = customizer ? customizer(value, srcValue, key, object, source) : undefined,
              isCommon = typeof result == 'undefined';
          if (isCommon) {
            result = srcValue;
            if (isLength(srcValue.length) && (isArray(srcValue) || isTypedArray(srcValue))) {
              result = isArray(value) ? value : (value ? arrayCopy(value) : []);
            } else if (isPlainObject(srcValue) || isArguments(srcValue)) {
              result = isArguments(value) ? toPlainObject(value) : (isPlainObject(value) ? value : {});
            } else {
              isCommon = false;
            }
          }
          stackA.push(srcValue);
          stackB.push(result);
          if (isCommon) {
            object[key] = mergeFunc(result, srcValue, customizer, stackA, stackB);
          } else if (result === result ? result !== value : value === value) {
            object[key] = result;
          }
        }
        function baseProperty(key) {
          return function(object) {
            return object == null ? undefined : object[key];
          };
        }
        function basePullAt(array, indexes) {
          var length = indexes.length,
              result = baseAt(array, indexes);
          indexes.sort(baseCompareAscending);
          while (length--) {
            var index = parseFloat(indexes[length]);
            if (index != previous && isIndex(index)) {
              var previous = index;
              splice.call(array, index, 1);
            }
          }
          return result;
        }
        function baseRandom(min, max) {
          return min + floor(nativeRandom() * (max - min + 1));
        }
        function baseReduce(collection, iteratee, accumulator, initFromCollection, eachFunc) {
          eachFunc(collection, function(value, index, collection) {
            accumulator = initFromCollection ? (initFromCollection = false, value) : iteratee(accumulator, value, index, collection);
          });
          return accumulator;
        }
        var baseSetData = !metaMap ? identity : function(func, data) {
          metaMap.set(func, data);
          return func;
        };
        function baseSlice(array, start, end) {
          var index = -1,
              length = array.length;
          start = start == null ? 0 : (+start || 0);
          if (start < 0) {
            start = -start > length ? 0 : (length + start);
          }
          end = (typeof end == 'undefined' || end > length) ? length : (+end || 0);
          if (end < 0) {
            end += length;
          }
          length = start > end ? 0 : (end - start) >>> 0;
          start >>>= 0;
          var result = Array(length);
          while (++index < length) {
            result[index] = array[index + start];
          }
          return result;
        }
        function baseSome(collection, predicate) {
          var result;
          baseEach(collection, function(value, index, collection) {
            result = predicate(value, index, collection);
            return !result;
          });
          return !!result;
        }
        function baseUniq(array, iteratee) {
          var index = -1,
              indexOf = getIndexOf(),
              length = array.length,
              isCommon = indexOf == baseIndexOf,
              isLarge = isCommon && length >= 200,
              seen = isLarge && createCache(),
              result = [];
          if (seen) {
            indexOf = cacheIndexOf;
            isCommon = false;
          } else {
            isLarge = false;
            seen = iteratee ? [] : result;
          }
          outer: while (++index < length) {
            var value = array[index],
                computed = iteratee ? iteratee(value, index, array) : value;
            if (isCommon && value === value) {
              var seenIndex = seen.length;
              while (seenIndex--) {
                if (seen[seenIndex] === computed) {
                  continue outer;
                }
              }
              if (iteratee) {
                seen.push(computed);
              }
              result.push(value);
            } else if (indexOf(seen, computed) < 0) {
              if (iteratee || isLarge) {
                seen.push(computed);
              }
              result.push(value);
            }
          }
          return result;
        }
        function baseValues(object, props) {
          var index = -1,
              length = props.length,
              result = Array(length);
          while (++index < length) {
            result[index] = object[props[index]];
          }
          return result;
        }
        function baseWrapperValue(value, actions) {
          var result = value;
          if (result instanceof LazyWrapper) {
            result = result.value();
          }
          var index = -1,
              length = actions.length;
          while (++index < length) {
            var args = [result],
                action = actions[index];
            push.apply(args, action.args);
            result = action.func.apply(action.thisArg, args);
          }
          return result;
        }
        function binaryIndex(array, value, retHighest) {
          var low = 0,
              high = array ? array.length : low;
          if (typeof value == 'number' && value === value && high <= HALF_MAX_ARRAY_LENGTH) {
            while (low < high) {
              var mid = (low + high) >>> 1,
                  computed = array[mid];
              if (retHighest ? (computed <= value) : (computed < value)) {
                low = mid + 1;
              } else {
                high = mid;
              }
            }
            return high;
          }
          return binaryIndexBy(array, value, identity, retHighest);
        }
        function binaryIndexBy(array, value, iteratee, retHighest) {
          value = iteratee(value);
          var low = 0,
              high = array ? array.length : 0,
              valIsNaN = value !== value,
              valIsUndef = typeof value == 'undefined';
          while (low < high) {
            var mid = floor((low + high) / 2),
                computed = iteratee(array[mid]),
                isReflexive = computed === computed;
            if (valIsNaN) {
              var setLow = isReflexive || retHighest;
            } else if (valIsUndef) {
              setLow = isReflexive && (retHighest || typeof computed != 'undefined');
            } else {
              setLow = retHighest ? (computed <= value) : (computed < value);
            }
            if (setLow) {
              low = mid + 1;
            } else {
              high = mid;
            }
          }
          return nativeMin(high, MAX_ARRAY_INDEX);
        }
        function bindCallback(func, thisArg, argCount) {
          if (typeof func != 'function') {
            return identity;
          }
          if (typeof thisArg == 'undefined') {
            return func;
          }
          switch (argCount) {
            case 1:
              return function(value) {
                return func.call(thisArg, value);
              };
            case 3:
              return function(value, index, collection) {
                return func.call(thisArg, value, index, collection);
              };
            case 4:
              return function(accumulator, value, index, collection) {
                return func.call(thisArg, accumulator, value, index, collection);
              };
            case 5:
              return function(value, other, key, object, source) {
                return func.call(thisArg, value, other, key, object, source);
              };
          }
          return function() {
            return func.apply(thisArg, arguments);
          };
        }
        function bufferClone(buffer) {
          return bufferSlice.call(buffer, 0);
        }
        if (!bufferSlice) {
          bufferClone = !(ArrayBuffer && Uint8Array) ? constant(null) : function(buffer) {
            var byteLength = buffer.byteLength,
                floatLength = Float64Array ? floor(byteLength / FLOAT64_BYTES_PER_ELEMENT) : 0,
                offset = floatLength * FLOAT64_BYTES_PER_ELEMENT,
                result = new ArrayBuffer(byteLength);
            if (floatLength) {
              var view = new Float64Array(result, 0, floatLength);
              view.set(new Float64Array(buffer, 0, floatLength));
            }
            if (byteLength != offset) {
              view = new Uint8Array(result, offset);
              view.set(new Uint8Array(buffer, offset));
            }
            return result;
          };
        }
        function composeArgs(args, partials, holders) {
          var holdersLength = holders.length,
              argsIndex = -1,
              argsLength = nativeMax(args.length - holdersLength, 0),
              leftIndex = -1,
              leftLength = partials.length,
              result = Array(argsLength + leftLength);
          while (++leftIndex < leftLength) {
            result[leftIndex] = partials[leftIndex];
          }
          while (++argsIndex < holdersLength) {
            result[holders[argsIndex]] = args[argsIndex];
          }
          while (argsLength--) {
            result[leftIndex++] = args[argsIndex++];
          }
          return result;
        }
        function composeArgsRight(args, partials, holders) {
          var holdersIndex = -1,
              holdersLength = holders.length,
              argsIndex = -1,
              argsLength = nativeMax(args.length - holdersLength, 0),
              rightIndex = -1,
              rightLength = partials.length,
              result = Array(argsLength + rightLength);
          while (++argsIndex < argsLength) {
            result[argsIndex] = args[argsIndex];
          }
          var pad = argsIndex;
          while (++rightIndex < rightLength) {
            result[pad + rightIndex] = partials[rightIndex];
          }
          while (++holdersIndex < holdersLength) {
            result[pad + holders[holdersIndex]] = args[argsIndex++];
          }
          return result;
        }
        function createAggregator(setter, initializer) {
          return function(collection, iteratee, thisArg) {
            var result = initializer ? initializer() : {};
            iteratee = getCallback(iteratee, thisArg, 3);
            if (isArray(collection)) {
              var index = -1,
                  length = collection.length;
              while (++index < length) {
                var value = collection[index];
                setter(result, value, iteratee(value, index, collection), collection);
              }
            } else {
              baseEach(collection, function(value, key, collection) {
                setter(result, value, iteratee(value, key, collection), collection);
              });
            }
            return result;
          };
        }
        function createAssigner(assigner) {
          return function() {
            var length = arguments.length,
                object = arguments[0];
            if (length < 2 || object == null) {
              return object;
            }
            if (length > 3 && isIterateeCall(arguments[1], arguments[2], arguments[3])) {
              length = 2;
            }
            if (length > 3 && typeof arguments[length - 2] == 'function') {
              var customizer = bindCallback(arguments[--length - 1], arguments[length--], 5);
            } else if (length > 2 && typeof arguments[length - 1] == 'function') {
              customizer = arguments[--length];
            }
            var index = 0;
            while (++index < length) {
              var source = arguments[index];
              if (source) {
                assigner(object, source, customizer);
              }
            }
            return object;
          };
        }
        function createBindWrapper(func, thisArg) {
          var Ctor = createCtorWrapper(func);
          function wrapper() {
            return (this instanceof wrapper ? Ctor : func).apply(thisArg, arguments);
          }
          return wrapper;
        }
        var createCache = !(nativeCreate && Set) ? constant(null) : function(values) {
          return new SetCache(values);
        };
        function createCompounder(callback) {
          return function(string) {
            var index = -1,
                array = words(deburr(string)),
                length = array.length,
                result = '';
            while (++index < length) {
              result = callback(result, array[index], index);
            }
            return result;
          };
        }
        function createCtorWrapper(Ctor) {
          return function() {
            var thisBinding = baseCreate(Ctor.prototype),
                result = Ctor.apply(thisBinding, arguments);
            return isObject(result) ? result : thisBinding;
          };
        }
        function createExtremum(arrayFunc, isMin) {
          return function(collection, iteratee, thisArg) {
            if (thisArg && isIterateeCall(collection, iteratee, thisArg)) {
              iteratee = null;
            }
            var func = getCallback(),
                noIteratee = iteratee == null;
            if (!(func === baseCallback && noIteratee)) {
              noIteratee = false;
              iteratee = func(iteratee, thisArg, 3);
            }
            if (noIteratee) {
              var isArr = isArray(collection);
              if (!isArr && isString(collection)) {
                iteratee = charAtCallback;
              } else {
                return arrayFunc(isArr ? collection : toIterable(collection));
              }
            }
            return extremumBy(collection, iteratee, isMin);
          };
        }
        function createHybridWrapper(func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary, arity) {
          var isAry = bitmask & ARY_FLAG,
              isBind = bitmask & BIND_FLAG,
              isBindKey = bitmask & BIND_KEY_FLAG,
              isCurry = bitmask & CURRY_FLAG,
              isCurryBound = bitmask & CURRY_BOUND_FLAG,
              isCurryRight = bitmask & CURRY_RIGHT_FLAG;
          var Ctor = !isBindKey && createCtorWrapper(func),
              key = func;
          function wrapper() {
            var length = arguments.length,
                index = length,
                args = Array(length);
            while (index--) {
              args[index] = arguments[index];
            }
            if (partials) {
              args = composeArgs(args, partials, holders);
            }
            if (partialsRight) {
              args = composeArgsRight(args, partialsRight, holdersRight);
            }
            if (isCurry || isCurryRight) {
              var placeholder = wrapper.placeholder,
                  argsHolders = replaceHolders(args, placeholder);
              length -= argsHolders.length;
              if (length < arity) {
                var newArgPos = argPos ? arrayCopy(argPos) : null,
                    newArity = nativeMax(arity - length, 0),
                    newsHolders = isCurry ? argsHolders : null,
                    newHoldersRight = isCurry ? null : argsHolders,
                    newPartials = isCurry ? args : null,
                    newPartialsRight = isCurry ? null : args;
                bitmask |= (isCurry ? PARTIAL_FLAG : PARTIAL_RIGHT_FLAG);
                bitmask &= ~(isCurry ? PARTIAL_RIGHT_FLAG : PARTIAL_FLAG);
                if (!isCurryBound) {
                  bitmask &= ~(BIND_FLAG | BIND_KEY_FLAG);
                }
                var result = createHybridWrapper(func, bitmask, thisArg, newPartials, newsHolders, newPartialsRight, newHoldersRight, newArgPos, ary, newArity);
                result.placeholder = placeholder;
                return result;
              }
            }
            var thisBinding = isBind ? thisArg : this;
            if (isBindKey) {
              func = thisBinding[key];
            }
            if (argPos) {
              args = reorder(args, argPos);
            }
            if (isAry && ary < args.length) {
              args.length = ary;
            }
            return (this instanceof wrapper ? (Ctor || createCtorWrapper(func)) : func).apply(thisBinding, args);
          }
          return wrapper;
        }
        function createPad(string, length, chars) {
          var strLength = string.length;
          length = +length;
          if (strLength >= length || !nativeIsFinite(length)) {
            return '';
          }
          var padLength = length - strLength;
          chars = chars == null ? ' ' : (chars + '');
          return repeat(chars, ceil(padLength / chars.length)).slice(0, padLength);
        }
        function createPartialWrapper(func, bitmask, thisArg, partials) {
          var isBind = bitmask & BIND_FLAG,
              Ctor = createCtorWrapper(func);
          function wrapper() {
            var argsIndex = -1,
                argsLength = arguments.length,
                leftIndex = -1,
                leftLength = partials.length,
                args = Array(argsLength + leftLength);
            while (++leftIndex < leftLength) {
              args[leftIndex] = partials[leftIndex];
            }
            while (argsLength--) {
              args[leftIndex++] = arguments[++argsIndex];
            }
            return (this instanceof wrapper ? Ctor : func).apply(isBind ? thisArg : this, args);
          }
          return wrapper;
        }
        function createWrapper(func, bitmask, thisArg, partials, holders, argPos, ary, arity) {
          var isBindKey = bitmask & BIND_KEY_FLAG;
          if (!isBindKey && typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          var length = partials ? partials.length : 0;
          if (!length) {
            bitmask &= ~(PARTIAL_FLAG | PARTIAL_RIGHT_FLAG);
            partials = holders = null;
          }
          length -= (holders ? holders.length : 0);
          if (bitmask & PARTIAL_RIGHT_FLAG) {
            var partialsRight = partials,
                holdersRight = holders;
            partials = holders = null;
          }
          var data = !isBindKey && getData(func),
              newData = [func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary, arity];
          if (data && data !== true) {
            mergeData(newData, data);
            bitmask = newData[1];
            arity = newData[9];
          }
          newData[9] = arity == null ? (isBindKey ? 0 : func.length) : (nativeMax(arity - length, 0) || 0);
          if (bitmask == BIND_FLAG) {
            var result = createBindWrapper(newData[0], newData[2]);
          } else if ((bitmask == PARTIAL_FLAG || bitmask == (BIND_FLAG | PARTIAL_FLAG)) && !newData[4].length) {
            result = createPartialWrapper.apply(undefined, newData);
          } else {
            result = createHybridWrapper.apply(undefined, newData);
          }
          var setter = data ? baseSetData : setData;
          return setter(result, newData);
        }
        function equalArrays(array, other, equalFunc, customizer, isWhere, stackA, stackB) {
          var index = -1,
              arrLength = array.length,
              othLength = other.length,
              result = true;
          if (arrLength != othLength && !(isWhere && othLength > arrLength)) {
            return false;
          }
          while (result && ++index < arrLength) {
            var arrValue = array[index],
                othValue = other[index];
            result = undefined;
            if (customizer) {
              result = isWhere ? customizer(othValue, arrValue, index) : customizer(arrValue, othValue, index);
            }
            if (typeof result == 'undefined') {
              if (isWhere) {
                var othIndex = othLength;
                while (othIndex--) {
                  othValue = other[othIndex];
                  result = (arrValue && arrValue === othValue) || equalFunc(arrValue, othValue, customizer, isWhere, stackA, stackB);
                  if (result) {
                    break;
                  }
                }
              } else {
                result = (arrValue && arrValue === othValue) || equalFunc(arrValue, othValue, customizer, isWhere, stackA, stackB);
              }
            }
          }
          return !!result;
        }
        function equalByTag(object, other, tag) {
          switch (tag) {
            case boolTag:
            case dateTag:
              return +object == +other;
            case errorTag:
              return object.name == other.name && object.message == other.message;
            case numberTag:
              return (object != +object) ? other != +other : (object == 0 ? ((1 / object) == (1 / other)) : object == +other);
            case regexpTag:
            case stringTag:
              return object == (other + '');
          }
          return false;
        }
        function equalObjects(object, other, equalFunc, customizer, isWhere, stackA, stackB) {
          var objProps = keys(object),
              objLength = objProps.length,
              othProps = keys(other),
              othLength = othProps.length;
          if (objLength != othLength && !isWhere) {
            return false;
          }
          var hasCtor,
              index = -1;
          while (++index < objLength) {
            var key = objProps[index],
                result = hasOwnProperty.call(other, key);
            if (result) {
              var objValue = object[key],
                  othValue = other[key];
              result = undefined;
              if (customizer) {
                result = isWhere ? customizer(othValue, objValue, key) : customizer(objValue, othValue, key);
              }
              if (typeof result == 'undefined') {
                result = (objValue && objValue === othValue) || equalFunc(objValue, othValue, customizer, isWhere, stackA, stackB);
              }
            }
            if (!result) {
              return false;
            }
            hasCtor || (hasCtor = key == 'constructor');
          }
          if (!hasCtor) {
            var objCtor = object.constructor,
                othCtor = other.constructor;
            if (objCtor != othCtor && ('constructor' in object && 'constructor' in other) && !(typeof objCtor == 'function' && objCtor instanceof objCtor && typeof othCtor == 'function' && othCtor instanceof othCtor)) {
              return false;
            }
          }
          return true;
        }
        function extremumBy(collection, iteratee, isMin) {
          var exValue = isMin ? POSITIVE_INFINITY : NEGATIVE_INFINITY,
              computed = exValue,
              result = computed;
          baseEach(collection, function(value, index, collection) {
            var current = iteratee(value, index, collection);
            if ((isMin ? current < computed : current > computed) || (current === exValue && current === result)) {
              computed = current;
              result = value;
            }
          });
          return result;
        }
        function getCallback(func, thisArg, argCount) {
          var result = lodash.callback || callback;
          result = result === callback ? baseCallback : result;
          return argCount ? result(func, thisArg, argCount) : result;
        }
        var getData = !metaMap ? noop : function(func) {
          return metaMap.get(func);
        };
        function getIndexOf(collection, target, fromIndex) {
          var result = lodash.indexOf || indexOf;
          result = result === indexOf ? baseIndexOf : result;
          return collection ? result(collection, target, fromIndex) : result;
        }
        function getView(start, end, transforms) {
          var index = -1,
              length = transforms ? transforms.length : 0;
          while (++index < length) {
            var data = transforms[index],
                size = data.size;
            switch (data.type) {
              case 'drop':
                start += size;
                break;
              case 'dropRight':
                end -= size;
                break;
              case 'take':
                end = nativeMin(end, start + size);
                break;
              case 'takeRight':
                start = nativeMax(start, end - size);
                break;
            }
          }
          return {
            'start': start,
            'end': end
          };
        }
        function initCloneArray(array) {
          var length = array.length,
              result = new array.constructor(length);
          if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
            result.index = array.index;
            result.input = array.input;
          }
          return result;
        }
        function initCloneObject(object) {
          var Ctor = object.constructor;
          if (!(typeof Ctor == 'function' && Ctor instanceof Ctor)) {
            Ctor = Object;
          }
          return new Ctor;
        }
        function initCloneByTag(object, tag, isDeep) {
          var Ctor = object.constructor;
          switch (tag) {
            case arrayBufferTag:
              return bufferClone(object);
            case boolTag:
            case dateTag:
              return new Ctor(+object);
            case float32Tag:
            case float64Tag:
            case int8Tag:
            case int16Tag:
            case int32Tag:
            case uint8Tag:
            case uint8ClampedTag:
            case uint16Tag:
            case uint32Tag:
              var buffer = object.buffer;
              return new Ctor(isDeep ? bufferClone(buffer) : buffer, object.byteOffset, object.length);
            case numberTag:
            case stringTag:
              return new Ctor(object);
            case regexpTag:
              var result = new Ctor(object.source, reFlags.exec(object));
              result.lastIndex = object.lastIndex;
          }
          return result;
        }
        function isBindable(func) {
          var support = lodash.support,
              result = !(support.funcNames ? func.name : support.funcDecomp);
          if (!result) {
            var source = fnToString.call(func);
            if (!support.funcNames) {
              result = !reFuncName.test(source);
            }
            if (!result) {
              result = reThis.test(source) || isNative(func);
              baseSetData(func, result);
            }
          }
          return result;
        }
        function isIndex(value, length) {
          value = +value;
          length = length == null ? MAX_SAFE_INTEGER : length;
          return value > -1 && value % 1 == 0 && value < length;
        }
        function isIterateeCall(value, index, object) {
          if (!isObject(object)) {
            return false;
          }
          var type = typeof index;
          if (type == 'number') {
            var length = object.length,
                prereq = isLength(length) && isIndex(index, length);
          } else {
            prereq = type == 'string' && index in object;
          }
          return prereq && object[index] === value;
        }
        function isLength(value) {
          return typeof value == 'number' && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
        }
        function isStrictComparable(value) {
          return value === value && (value === 0 ? ((1 / value) > 0) : !isObject(value));
        }
        function mergeData(data, source) {
          var bitmask = data[1],
              srcBitmask = source[1],
              newBitmask = bitmask | srcBitmask;
          var arityFlags = ARY_FLAG | REARG_FLAG,
              bindFlags = BIND_FLAG | BIND_KEY_FLAG,
              comboFlags = arityFlags | bindFlags | CURRY_BOUND_FLAG | CURRY_RIGHT_FLAG;
          var isAry = bitmask & ARY_FLAG && !(srcBitmask & ARY_FLAG),
              isRearg = bitmask & REARG_FLAG && !(srcBitmask & REARG_FLAG),
              argPos = (isRearg ? data : source)[7],
              ary = (isAry ? data : source)[8];
          var isCommon = !(bitmask >= REARG_FLAG && srcBitmask > bindFlags) && !(bitmask > bindFlags && srcBitmask >= REARG_FLAG);
          var isCombo = (newBitmask >= arityFlags && newBitmask <= comboFlags) && (bitmask < REARG_FLAG || ((isRearg || isAry) && argPos.length <= ary));
          if (!(isCommon || isCombo)) {
            return data;
          }
          if (srcBitmask & BIND_FLAG) {
            data[2] = source[2];
            newBitmask |= (bitmask & BIND_FLAG) ? 0 : CURRY_BOUND_FLAG;
          }
          var value = source[3];
          if (value) {
            var partials = data[3];
            data[3] = partials ? composeArgs(partials, value, source[4]) : arrayCopy(value);
            data[4] = partials ? replaceHolders(data[3], PLACEHOLDER) : arrayCopy(source[4]);
          }
          value = source[5];
          if (value) {
            partials = data[5];
            data[5] = partials ? composeArgsRight(partials, value, source[6]) : arrayCopy(value);
            data[6] = partials ? replaceHolders(data[5], PLACEHOLDER) : arrayCopy(source[6]);
          }
          value = source[7];
          if (value) {
            data[7] = arrayCopy(value);
          }
          if (srcBitmask & ARY_FLAG) {
            data[8] = data[8] == null ? source[8] : nativeMin(data[8], source[8]);
          }
          if (data[9] == null) {
            data[9] = source[9];
          }
          data[0] = source[0];
          data[1] = newBitmask;
          return data;
        }
        function pickByArray(object, props) {
          object = toObject(object);
          var index = -1,
              length = props.length,
              result = {};
          while (++index < length) {
            var key = props[index];
            if (key in object) {
              result[key] = object[key];
            }
          }
          return result;
        }
        function pickByCallback(object, predicate) {
          var result = {};
          baseForIn(object, function(value, key, object) {
            if (predicate(value, key, object)) {
              result[key] = value;
            }
          });
          return result;
        }
        function reorder(array, indexes) {
          var arrLength = array.length,
              length = nativeMin(indexes.length, arrLength),
              oldArray = arrayCopy(array);
          while (length--) {
            var index = indexes[length];
            array[length] = isIndex(index, arrLength) ? oldArray[index] : undefined;
          }
          return array;
        }
        var setData = (function() {
          var count = 0,
              lastCalled = 0;
          return function(key, value) {
            var stamp = now(),
                remaining = HOT_SPAN - (stamp - lastCalled);
            lastCalled = stamp;
            if (remaining > 0) {
              if (++count >= HOT_COUNT) {
                return key;
              }
            } else {
              count = 0;
            }
            return baseSetData(key, value);
          };
        }());
        function shimIsPlainObject(value) {
          var Ctor,
              support = lodash.support;
          if (!(isObjectLike(value) && objToString.call(value) == objectTag) || (!hasOwnProperty.call(value, 'constructor') && (Ctor = value.constructor, typeof Ctor == 'function' && !(Ctor instanceof Ctor)))) {
            return false;
          }
          var result;
          baseForIn(value, function(subValue, key) {
            result = key;
          });
          return typeof result == 'undefined' || hasOwnProperty.call(value, result);
        }
        function shimKeys(object) {
          var props = keysIn(object),
              propsLength = props.length,
              length = propsLength && object.length,
              support = lodash.support;
          var allowIndexes = length && isLength(length) && (isArray(object) || (support.nonEnumArgs && isArguments(object)));
          var index = -1,
              result = [];
          while (++index < propsLength) {
            var key = props[index];
            if ((allowIndexes && isIndex(key, length)) || hasOwnProperty.call(object, key)) {
              result.push(key);
            }
          }
          return result;
        }
        function toIterable(value) {
          if (value == null) {
            return [];
          }
          if (!isLength(value.length)) {
            return values(value);
          }
          return isObject(value) ? value : Object(value);
        }
        function toObject(value) {
          return isObject(value) ? value : Object(value);
        }
        function wrapperClone(wrapper) {
          return wrapper instanceof LazyWrapper ? wrapper.clone() : new LodashWrapper(wrapper.__wrapped__, wrapper.__chain__, arrayCopy(wrapper.__actions__));
        }
        function chunk(array, size, guard) {
          if (guard ? isIterateeCall(array, size, guard) : size == null) {
            size = 1;
          } else {
            size = nativeMax(+size || 1, 1);
          }
          var index = 0,
              length = array ? array.length : 0,
              resIndex = -1,
              result = Array(ceil(length / size));
          while (index < length) {
            result[++resIndex] = baseSlice(array, index, (index += size));
          }
          return result;
        }
        function compact(array) {
          var index = -1,
              length = array ? array.length : 0,
              resIndex = -1,
              result = [];
          while (++index < length) {
            var value = array[index];
            if (value) {
              result[++resIndex] = value;
            }
          }
          return result;
        }
        function difference() {
          var index = -1,
              length = arguments.length;
          while (++index < length) {
            var value = arguments[index];
            if (isArray(value) || isArguments(value)) {
              break;
            }
          }
          return baseDifference(value, baseFlatten(arguments, false, true, ++index));
        }
        function drop(array, n, guard) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (guard ? isIterateeCall(array, n, guard) : n == null) {
            n = 1;
          }
          return baseSlice(array, n < 0 ? 0 : n);
        }
        function dropRight(array, n, guard) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (guard ? isIterateeCall(array, n, guard) : n == null) {
            n = 1;
          }
          n = length - (+n || 0);
          return baseSlice(array, 0, n < 0 ? 0 : n);
        }
        function dropRightWhile(array, predicate, thisArg) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          predicate = getCallback(predicate, thisArg, 3);
          while (length-- && predicate(array[length], length, array)) {}
          return baseSlice(array, 0, length + 1);
        }
        function dropWhile(array, predicate, thisArg) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          var index = -1;
          predicate = getCallback(predicate, thisArg, 3);
          while (++index < length && predicate(array[index], index, array)) {}
          return baseSlice(array, index);
        }
        function fill(array, value, start, end) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (start && typeof start != 'number' && isIterateeCall(array, value, start)) {
            start = 0;
            end = length;
          }
          return baseFill(array, value, start, end);
        }
        function findIndex(array, predicate, thisArg) {
          var index = -1,
              length = array ? array.length : 0;
          predicate = getCallback(predicate, thisArg, 3);
          while (++index < length) {
            if (predicate(array[index], index, array)) {
              return index;
            }
          }
          return -1;
        }
        function findLastIndex(array, predicate, thisArg) {
          var length = array ? array.length : 0;
          predicate = getCallback(predicate, thisArg, 3);
          while (length--) {
            if (predicate(array[length], length, array)) {
              return length;
            }
          }
          return -1;
        }
        function first(array) {
          return array ? array[0] : undefined;
        }
        function flatten(array, isDeep, guard) {
          var length = array ? array.length : 0;
          if (guard && isIterateeCall(array, isDeep, guard)) {
            isDeep = false;
          }
          return length ? baseFlatten(array, isDeep) : [];
        }
        function flattenDeep(array) {
          var length = array ? array.length : 0;
          return length ? baseFlatten(array, true) : [];
        }
        function indexOf(array, value, fromIndex) {
          var length = array ? array.length : 0;
          if (!length) {
            return -1;
          }
          if (typeof fromIndex == 'number') {
            fromIndex = fromIndex < 0 ? nativeMax(length + fromIndex, 0) : (fromIndex || 0);
          } else if (fromIndex) {
            var index = binaryIndex(array, value),
                other = array[index];
            return (value === value ? value === other : other !== other) ? index : -1;
          }
          return baseIndexOf(array, value, fromIndex);
        }
        function initial(array) {
          return dropRight(array, 1);
        }
        function intersection() {
          var args = [],
              argsIndex = -1,
              argsLength = arguments.length,
              caches = [],
              indexOf = getIndexOf(),
              isCommon = indexOf == baseIndexOf;
          while (++argsIndex < argsLength) {
            var value = arguments[argsIndex];
            if (isArray(value) || isArguments(value)) {
              args.push(value);
              caches.push(isCommon && value.length >= 120 && createCache(argsIndex && value));
            }
          }
          argsLength = args.length;
          var array = args[0],
              index = -1,
              length = array ? array.length : 0,
              result = [],
              seen = caches[0];
          outer: while (++index < length) {
            value = array[index];
            if ((seen ? cacheIndexOf(seen, value) : indexOf(result, value)) < 0) {
              argsIndex = argsLength;
              while (--argsIndex) {
                var cache = caches[argsIndex];
                if ((cache ? cacheIndexOf(cache, value) : indexOf(args[argsIndex], value)) < 0) {
                  continue outer;
                }
              }
              if (seen) {
                seen.push(value);
              }
              result.push(value);
            }
          }
          return result;
        }
        function last(array) {
          var length = array ? array.length : 0;
          return length ? array[length - 1] : undefined;
        }
        function lastIndexOf(array, value, fromIndex) {
          var length = array ? array.length : 0;
          if (!length) {
            return -1;
          }
          var index = length;
          if (typeof fromIndex == 'number') {
            index = (fromIndex < 0 ? nativeMax(length + fromIndex, 0) : nativeMin(fromIndex || 0, length - 1)) + 1;
          } else if (fromIndex) {
            index = binaryIndex(array, value, true) - 1;
            var other = array[index];
            return (value === value ? value === other : other !== other) ? index : -1;
          }
          if (value !== value) {
            return indexOfNaN(array, index, true);
          }
          while (index--) {
            if (array[index] === value) {
              return index;
            }
          }
          return -1;
        }
        function pull() {
          var array = arguments[0];
          if (!(array && array.length)) {
            return array;
          }
          var index = 0,
              indexOf = getIndexOf(),
              length = arguments.length;
          while (++index < length) {
            var fromIndex = 0,
                value = arguments[index];
            while ((fromIndex = indexOf(array, value, fromIndex)) > -1) {
              splice.call(array, fromIndex, 1);
            }
          }
          return array;
        }
        function pullAt(array) {
          return basePullAt(array || [], baseFlatten(arguments, false, false, 1));
        }
        function remove(array, predicate, thisArg) {
          var index = -1,
              length = array ? array.length : 0,
              result = [];
          predicate = getCallback(predicate, thisArg, 3);
          while (++index < length) {
            var value = array[index];
            if (predicate(value, index, array)) {
              result.push(value);
              splice.call(array, index--, 1);
              length--;
            }
          }
          return result;
        }
        function rest(array) {
          return drop(array, 1);
        }
        function slice(array, start, end) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (end && typeof end != 'number' && isIterateeCall(array, start, end)) {
            start = 0;
            end = length;
          }
          return baseSlice(array, start, end);
        }
        function sortedIndex(array, value, iteratee, thisArg) {
          var func = getCallback(iteratee);
          return (func === baseCallback && iteratee == null) ? binaryIndex(array, value) : binaryIndexBy(array, value, func(iteratee, thisArg, 1));
        }
        function sortedLastIndex(array, value, iteratee, thisArg) {
          var func = getCallback(iteratee);
          return (func === baseCallback && iteratee == null) ? binaryIndex(array, value, true) : binaryIndexBy(array, value, func(iteratee, thisArg, 1), true);
        }
        function take(array, n, guard) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (guard ? isIterateeCall(array, n, guard) : n == null) {
            n = 1;
          }
          return baseSlice(array, 0, n < 0 ? 0 : n);
        }
        function takeRight(array, n, guard) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (guard ? isIterateeCall(array, n, guard) : n == null) {
            n = 1;
          }
          n = length - (+n || 0);
          return baseSlice(array, n < 0 ? 0 : n);
        }
        function takeRightWhile(array, predicate, thisArg) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          predicate = getCallback(predicate, thisArg, 3);
          while (length-- && predicate(array[length], length, array)) {}
          return baseSlice(array, length + 1);
        }
        function takeWhile(array, predicate, thisArg) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          var index = -1;
          predicate = getCallback(predicate, thisArg, 3);
          while (++index < length && predicate(array[index], index, array)) {}
          return baseSlice(array, 0, index);
        }
        function union() {
          return baseUniq(baseFlatten(arguments, false, true));
        }
        function uniq(array, isSorted, iteratee, thisArg) {
          var length = array ? array.length : 0;
          if (!length) {
            return [];
          }
          if (typeof isSorted != 'boolean' && isSorted != null) {
            thisArg = iteratee;
            iteratee = isIterateeCall(array, isSorted, thisArg) ? null : isSorted;
            isSorted = false;
          }
          var func = getCallback();
          if (!(func === baseCallback && iteratee == null)) {
            iteratee = func(iteratee, thisArg, 3);
          }
          return (isSorted && getIndexOf() == baseIndexOf) ? sortedUniq(array, iteratee) : baseUniq(array, iteratee);
        }
        function unzip(array) {
          var index = -1,
              length = (array && array.length && arrayMax(arrayMap(array, getLength))) >>> 0,
              result = Array(length);
          while (++index < length) {
            result[index] = arrayMap(array, baseProperty(index));
          }
          return result;
        }
        function without(array) {
          return baseDifference(array, baseSlice(arguments, 1));
        }
        function xor() {
          var index = -1,
              length = arguments.length;
          while (++index < length) {
            var array = arguments[index];
            if (isArray(array) || isArguments(array)) {
              var result = result ? baseDifference(result, array).concat(baseDifference(array, result)) : array;
            }
          }
          return result ? baseUniq(result) : [];
        }
        function zip() {
          var length = arguments.length,
              array = Array(length);
          while (length--) {
            array[length] = arguments[length];
          }
          return unzip(array);
        }
        function zipObject(props, values) {
          var index = -1,
              length = props ? props.length : 0,
              result = {};
          if (length && !values && !isArray(props[0])) {
            values = [];
          }
          while (++index < length) {
            var key = props[index];
            if (values) {
              result[key] = values[index];
            } else if (key) {
              result[key[0]] = key[1];
            }
          }
          return result;
        }
        function chain(value) {
          var result = lodash(value);
          result.__chain__ = true;
          return result;
        }
        function tap(value, interceptor, thisArg) {
          interceptor.call(thisArg, value);
          return value;
        }
        function thru(value, interceptor, thisArg) {
          return interceptor.call(thisArg, value);
        }
        function wrapperChain() {
          return chain(this);
        }
        function wrapperCommit() {
          return new LodashWrapper(this.value(), this.__chain__);
        }
        function wrapperPlant(value) {
          var result,
              parent = this;
          while (parent instanceof LodashWrapper) {
            var clone = wrapperClone(parent);
            if (result) {
              previous.__wrapped__ = clone;
            } else {
              result = clone;
            }
            var previous = clone;
            parent = parent.__wrapped__;
          }
          previous.__wrapped__ = value;
          return result;
        }
        function wrapperReverse() {
          var value = this.__wrapped__;
          if (value instanceof LazyWrapper) {
            if (this.__actions__.length) {
              value = new LazyWrapper(this);
            }
            return new LodashWrapper(value.reverse(), this.__chain__);
          }
          return this.thru(function(value) {
            return value.reverse();
          });
        }
        function wrapperToString() {
          return (this.value() + '');
        }
        function wrapperValue() {
          return baseWrapperValue(this.__wrapped__, this.__actions__);
        }
        function at(collection) {
          var length = collection ? collection.length : 0;
          if (isLength(length)) {
            collection = toIterable(collection);
          }
          return baseAt(collection, baseFlatten(arguments, false, false, 1));
        }
        function includes(collection, target, fromIndex) {
          var length = collection ? collection.length : 0;
          if (!isLength(length)) {
            collection = values(collection);
            length = collection.length;
          }
          if (!length) {
            return false;
          }
          if (typeof fromIndex == 'number') {
            fromIndex = fromIndex < 0 ? nativeMax(length + fromIndex, 0) : (fromIndex || 0);
          } else {
            fromIndex = 0;
          }
          return (typeof collection == 'string' || !isArray(collection) && isString(collection)) ? (fromIndex < length && collection.indexOf(target, fromIndex) > -1) : (getIndexOf(collection, target, fromIndex) > -1);
        }
        var countBy = createAggregator(function(result, value, key) {
          hasOwnProperty.call(result, key) ? ++result[key] : (result[key] = 1);
        });
        function every(collection, predicate, thisArg) {
          var func = isArray(collection) ? arrayEvery : baseEvery;
          if (typeof predicate != 'function' || typeof thisArg != 'undefined') {
            predicate = getCallback(predicate, thisArg, 3);
          }
          return func(collection, predicate);
        }
        function filter(collection, predicate, thisArg) {
          var func = isArray(collection) ? arrayFilter : baseFilter;
          predicate = getCallback(predicate, thisArg, 3);
          return func(collection, predicate);
        }
        function find(collection, predicate, thisArg) {
          if (isArray(collection)) {
            var index = findIndex(collection, predicate, thisArg);
            return index > -1 ? collection[index] : undefined;
          }
          predicate = getCallback(predicate, thisArg, 3);
          return baseFind(collection, predicate, baseEach);
        }
        function findLast(collection, predicate, thisArg) {
          predicate = getCallback(predicate, thisArg, 3);
          return baseFind(collection, predicate, baseEachRight);
        }
        function findWhere(collection, source) {
          return find(collection, baseMatches(source));
        }
        function forEach(collection, iteratee, thisArg) {
          return (typeof iteratee == 'function' && typeof thisArg == 'undefined' && isArray(collection)) ? arrayEach(collection, iteratee) : baseEach(collection, bindCallback(iteratee, thisArg, 3));
        }
        function forEachRight(collection, iteratee, thisArg) {
          return (typeof iteratee == 'function' && typeof thisArg == 'undefined' && isArray(collection)) ? arrayEachRight(collection, iteratee) : baseEachRight(collection, bindCallback(iteratee, thisArg, 3));
        }
        var groupBy = createAggregator(function(result, value, key) {
          if (hasOwnProperty.call(result, key)) {
            result[key].push(value);
          } else {
            result[key] = [value];
          }
        });
        var indexBy = createAggregator(function(result, value, key) {
          result[key] = value;
        });
        function invoke(collection, methodName) {
          return baseInvoke(collection, methodName, baseSlice(arguments, 2));
        }
        function map(collection, iteratee, thisArg) {
          var func = isArray(collection) ? arrayMap : baseMap;
          iteratee = getCallback(iteratee, thisArg, 3);
          return func(collection, iteratee);
        }
        var max = createExtremum(arrayMax);
        var min = createExtremum(arrayMin, true);
        var partition = createAggregator(function(result, value, key) {
          result[key ? 0 : 1].push(value);
        }, function() {
          return [[], []];
        });
        function pluck(collection, key) {
          return map(collection, baseProperty(key));
        }
        function reduce(collection, iteratee, accumulator, thisArg) {
          var func = isArray(collection) ? arrayReduce : baseReduce;
          return func(collection, getCallback(iteratee, thisArg, 4), accumulator, arguments.length < 3, baseEach);
        }
        function reduceRight(collection, iteratee, accumulator, thisArg) {
          var func = isArray(collection) ? arrayReduceRight : baseReduce;
          return func(collection, getCallback(iteratee, thisArg, 4), accumulator, arguments.length < 3, baseEachRight);
        }
        function reject(collection, predicate, thisArg) {
          var func = isArray(collection) ? arrayFilter : baseFilter;
          predicate = getCallback(predicate, thisArg, 3);
          return func(collection, function(value, index, collection) {
            return !predicate(value, index, collection);
          });
        }
        function sample(collection, n, guard) {
          if (guard ? isIterateeCall(collection, n, guard) : n == null) {
            collection = toIterable(collection);
            var length = collection.length;
            return length > 0 ? collection[baseRandom(0, length - 1)] : undefined;
          }
          var result = shuffle(collection);
          result.length = nativeMin(n < 0 ? 0 : (+n || 0), result.length);
          return result;
        }
        function shuffle(collection) {
          collection = toIterable(collection);
          var index = -1,
              length = collection.length,
              result = Array(length);
          while (++index < length) {
            var rand = baseRandom(0, index);
            if (index != rand) {
              result[index] = result[rand];
            }
            result[rand] = collection[index];
          }
          return result;
        }
        function size(collection) {
          var length = collection ? collection.length : 0;
          return isLength(length) ? length : keys(collection).length;
        }
        function some(collection, predicate, thisArg) {
          var func = isArray(collection) ? arraySome : baseSome;
          if (typeof predicate != 'function' || typeof thisArg != 'undefined') {
            predicate = getCallback(predicate, thisArg, 3);
          }
          return func(collection, predicate);
        }
        function sortBy(collection, iteratee, thisArg) {
          var index = -1,
              length = collection ? collection.length : 0,
              result = isLength(length) ? Array(length) : [];
          if (thisArg && isIterateeCall(collection, iteratee, thisArg)) {
            iteratee = null;
          }
          iteratee = getCallback(iteratee, thisArg, 3);
          baseEach(collection, function(value, key, collection) {
            result[++index] = {
              'criteria': iteratee(value, key, collection),
              'index': index,
              'value': value
            };
          });
          return baseSortBy(result, compareAscending);
        }
        function sortByAll(collection) {
          var args = arguments;
          if (args.length > 3 && isIterateeCall(args[1], args[2], args[3])) {
            args = [collection, args[1]];
          }
          var index = -1,
              length = collection ? collection.length : 0,
              props = baseFlatten(args, false, false, 1),
              result = isLength(length) ? Array(length) : [];
          baseEach(collection, function(value) {
            var length = props.length,
                criteria = Array(length);
            while (length--) {
              criteria[length] = value == null ? undefined : value[props[length]];
            }
            result[++index] = {
              'criteria': criteria,
              'index': index,
              'value': value
            };
          });
          return baseSortBy(result, compareMultipleAscending);
        }
        function where(collection, source) {
          return filter(collection, baseMatches(source));
        }
        var now = nativeNow || function() {
          return new Date().getTime();
        };
        function after(n, func) {
          if (typeof func != 'function') {
            if (typeof n == 'function') {
              var temp = n;
              n = func;
              func = temp;
            } else {
              throw new TypeError(FUNC_ERROR_TEXT);
            }
          }
          n = nativeIsFinite(n = +n) ? n : 0;
          return function() {
            if (--n < 1) {
              return func.apply(this, arguments);
            }
          };
        }
        function ary(func, n, guard) {
          if (guard && isIterateeCall(func, n, guard)) {
            n = null;
          }
          n = (func && n == null) ? func.length : nativeMax(+n || 0, 0);
          return createWrapper(func, ARY_FLAG, null, null, null, null, n);
        }
        function before(n, func) {
          var result;
          if (typeof func != 'function') {
            if (typeof n == 'function') {
              var temp = n;
              n = func;
              func = temp;
            } else {
              throw new TypeError(FUNC_ERROR_TEXT);
            }
          }
          return function() {
            if (--n > 0) {
              result = func.apply(this, arguments);
            } else {
              func = null;
            }
            return result;
          };
        }
        function bind(func, thisArg) {
          var bitmask = BIND_FLAG;
          if (arguments.length > 2) {
            var partials = baseSlice(arguments, 2),
                holders = replaceHolders(partials, bind.placeholder);
            bitmask |= PARTIAL_FLAG;
          }
          return createWrapper(func, bitmask, thisArg, partials, holders);
        }
        function bindAll(object) {
          return baseBindAll(object, arguments.length > 1 ? baseFlatten(arguments, false, false, 1) : functions(object));
        }
        function bindKey(object, key) {
          var bitmask = BIND_FLAG | BIND_KEY_FLAG;
          if (arguments.length > 2) {
            var partials = baseSlice(arguments, 2),
                holders = replaceHolders(partials, bindKey.placeholder);
            bitmask |= PARTIAL_FLAG;
          }
          return createWrapper(key, bitmask, object, partials, holders);
        }
        function curry(func, arity, guard) {
          if (guard && isIterateeCall(func, arity, guard)) {
            arity = null;
          }
          var result = createWrapper(func, CURRY_FLAG, null, null, null, null, null, arity);
          result.placeholder = curry.placeholder;
          return result;
        }
        function curryRight(func, arity, guard) {
          if (guard && isIterateeCall(func, arity, guard)) {
            arity = null;
          }
          var result = createWrapper(func, CURRY_RIGHT_FLAG, null, null, null, null, null, arity);
          result.placeholder = curryRight.placeholder;
          return result;
        }
        function debounce(func, wait, options) {
          var args,
              maxTimeoutId,
              result,
              stamp,
              thisArg,
              timeoutId,
              trailingCall,
              lastCalled = 0,
              maxWait = false,
              trailing = true;
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          wait = wait < 0 ? 0 : wait;
          if (options === true) {
            var leading = true;
            trailing = false;
          } else if (isObject(options)) {
            leading = options.leading;
            maxWait = 'maxWait' in options && nativeMax(+options.maxWait || 0, wait);
            trailing = 'trailing' in options ? options.trailing : trailing;
          }
          function cancel() {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            if (maxTimeoutId) {
              clearTimeout(maxTimeoutId);
            }
            maxTimeoutId = timeoutId = trailingCall = undefined;
          }
          function delayed() {
            var remaining = wait - (now() - stamp);
            if (remaining <= 0 || remaining > wait) {
              if (maxTimeoutId) {
                clearTimeout(maxTimeoutId);
              }
              var isCalled = trailingCall;
              maxTimeoutId = timeoutId = trailingCall = undefined;
              if (isCalled) {
                lastCalled = now();
                result = func.apply(thisArg, args);
                if (!timeoutId && !maxTimeoutId) {
                  args = thisArg = null;
                }
              }
            } else {
              timeoutId = setTimeout(delayed, remaining);
            }
          }
          function maxDelayed() {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            maxTimeoutId = timeoutId = trailingCall = undefined;
            if (trailing || (maxWait !== wait)) {
              lastCalled = now();
              result = func.apply(thisArg, args);
              if (!timeoutId && !maxTimeoutId) {
                args = thisArg = null;
              }
            }
          }
          function debounced() {
            args = arguments;
            stamp = now();
            thisArg = this;
            trailingCall = trailing && (timeoutId || !leading);
            if (maxWait === false) {
              var leadingCall = leading && !timeoutId;
            } else {
              if (!maxTimeoutId && !leading) {
                lastCalled = stamp;
              }
              var remaining = maxWait - (stamp - lastCalled),
                  isCalled = remaining <= 0 || remaining > maxWait;
              if (isCalled) {
                if (maxTimeoutId) {
                  maxTimeoutId = clearTimeout(maxTimeoutId);
                }
                lastCalled = stamp;
                result = func.apply(thisArg, args);
              } else if (!maxTimeoutId) {
                maxTimeoutId = setTimeout(maxDelayed, remaining);
              }
            }
            if (isCalled && timeoutId) {
              timeoutId = clearTimeout(timeoutId);
            } else if (!timeoutId && wait !== maxWait) {
              timeoutId = setTimeout(delayed, wait);
            }
            if (leadingCall) {
              isCalled = true;
              result = func.apply(thisArg, args);
            }
            if (isCalled && !timeoutId && !maxTimeoutId) {
              args = thisArg = null;
            }
            return result;
          }
          debounced.cancel = cancel;
          return debounced;
        }
        function defer(func) {
          return baseDelay(func, 1, arguments, 1);
        }
        function delay(func, wait) {
          return baseDelay(func, wait, arguments, 2);
        }
        function flow() {
          var funcs = arguments,
              length = funcs.length;
          if (!length) {
            return function() {
              return arguments[0];
            };
          }
          if (!arrayEvery(funcs, isFunction)) {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return function() {
            var index = 0,
                result = funcs[index].apply(this, arguments);
            while (++index < length) {
              result = funcs[index].call(this, result);
            }
            return result;
          };
        }
        function flowRight() {
          var funcs = arguments,
              fromIndex = funcs.length - 1;
          if (fromIndex < 0) {
            return function() {
              return arguments[0];
            };
          }
          if (!arrayEvery(funcs, isFunction)) {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return function() {
            var index = fromIndex,
                result = funcs[index].apply(this, arguments);
            while (index--) {
              result = funcs[index].call(this, result);
            }
            return result;
          };
        }
        function memoize(func, resolver) {
          if (typeof func != 'function' || (resolver && typeof resolver != 'function')) {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          var memoized = function() {
            var cache = memoized.cache,
                key = resolver ? resolver.apply(this, arguments) : arguments[0];
            if (cache.has(key)) {
              return cache.get(key);
            }
            var result = func.apply(this, arguments);
            cache.set(key, result);
            return result;
          };
          memoized.cache = new memoize.Cache;
          return memoized;
        }
        function negate(predicate) {
          if (typeof predicate != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return function() {
            return !predicate.apply(this, arguments);
          };
        }
        function once(func) {
          return before(func, 2);
        }
        function partial(func) {
          var partials = baseSlice(arguments, 1),
              holders = replaceHolders(partials, partial.placeholder);
          return createWrapper(func, PARTIAL_FLAG, null, partials, holders);
        }
        function partialRight(func) {
          var partials = baseSlice(arguments, 1),
              holders = replaceHolders(partials, partialRight.placeholder);
          return createWrapper(func, PARTIAL_RIGHT_FLAG, null, partials, holders);
        }
        function rearg(func) {
          var indexes = baseFlatten(arguments, false, false, 1);
          return createWrapper(func, REARG_FLAG, null, null, null, indexes);
        }
        function spread(func) {
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          return function(array) {
            return func.apply(this, array);
          };
        }
        function throttle(func, wait, options) {
          var leading = true,
              trailing = true;
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          if (options === false) {
            leading = false;
          } else if (isObject(options)) {
            leading = 'leading' in options ? !!options.leading : leading;
            trailing = 'trailing' in options ? !!options.trailing : trailing;
          }
          debounceOptions.leading = leading;
          debounceOptions.maxWait = +wait;
          debounceOptions.trailing = trailing;
          return debounce(func, wait, debounceOptions);
        }
        function wrap(value, wrapper) {
          wrapper = wrapper == null ? identity : wrapper;
          return createWrapper(wrapper, PARTIAL_FLAG, null, [value], []);
        }
        function clone(value, isDeep, customizer, thisArg) {
          if (typeof isDeep != 'boolean' && isDeep != null) {
            thisArg = customizer;
            customizer = isIterateeCall(value, isDeep, thisArg) ? null : isDeep;
            isDeep = false;
          }
          customizer = typeof customizer == 'function' && bindCallback(customizer, thisArg, 1);
          return baseClone(value, isDeep, customizer);
        }
        function cloneDeep(value, customizer, thisArg) {
          customizer = typeof customizer == 'function' && bindCallback(customizer, thisArg, 1);
          return baseClone(value, true, customizer);
        }
        function isArguments(value) {
          var length = isObjectLike(value) ? value.length : undefined;
          return (isLength(length) && objToString.call(value) == argsTag) || false;
        }
        var isArray = nativeIsArray || function(value) {
          return (isObjectLike(value) && isLength(value.length) && objToString.call(value) == arrayTag) || false;
        };
        function isBoolean(value) {
          return (value === true || value === false || isObjectLike(value) && objToString.call(value) == boolTag) || false;
        }
        function isDate(value) {
          return (isObjectLike(value) && objToString.call(value) == dateTag) || false;
        }
        function isElement(value) {
          return (value && value.nodeType === 1 && isObjectLike(value) && objToString.call(value).indexOf('Element') > -1) || false;
        }
        if (!support.dom) {
          isElement = function(value) {
            return (value && value.nodeType === 1 && isObjectLike(value) && !isPlainObject(value)) || false;
          };
        }
        function isEmpty(value) {
          if (value == null) {
            return true;
          }
          var length = value.length;
          if (isLength(length) && (isArray(value) || isString(value) || isArguments(value) || (isObjectLike(value) && isFunction(value.splice)))) {
            return !length;
          }
          return !keys(value).length;
        }
        function isEqual(value, other, customizer, thisArg) {
          customizer = typeof customizer == 'function' && bindCallback(customizer, thisArg, 3);
          if (!customizer && isStrictComparable(value) && isStrictComparable(other)) {
            return value === other;
          }
          var result = customizer ? customizer(value, other) : undefined;
          return typeof result == 'undefined' ? baseIsEqual(value, other, customizer) : !!result;
        }
        function isError(value) {
          return (isObjectLike(value) && typeof value.message == 'string' && objToString.call(value) == errorTag) || false;
        }
        var isFinite = nativeNumIsFinite || function(value) {
          return typeof value == 'number' && nativeIsFinite(value);
        };
        function isFunction(value) {
          return typeof value == 'function' || false;
        }
        if (isFunction(/x/) || (Uint8Array && !isFunction(Uint8Array))) {
          isFunction = function(value) {
            return objToString.call(value) == funcTag;
          };
        }
        function isObject(value) {
          var type = typeof value;
          return type == 'function' || (value && type == 'object') || false;
        }
        function isMatch(object, source, customizer, thisArg) {
          var props = keys(source),
              length = props.length;
          customizer = typeof customizer == 'function' && bindCallback(customizer, thisArg, 3);
          if (!customizer && length == 1) {
            var key = props[0],
                value = source[key];
            if (isStrictComparable(value)) {
              return object != null && value === object[key] && hasOwnProperty.call(object, key);
            }
          }
          var values = Array(length),
              strictCompareFlags = Array(length);
          while (length--) {
            value = values[length] = source[props[length]];
            strictCompareFlags[length] = isStrictComparable(value);
          }
          return baseIsMatch(object, props, values, strictCompareFlags, customizer);
        }
        function isNaN(value) {
          return isNumber(value) && value != +value;
        }
        function isNative(value) {
          if (value == null) {
            return false;
          }
          if (objToString.call(value) == funcTag) {
            return reNative.test(fnToString.call(value));
          }
          return (isObjectLike(value) && reHostCtor.test(value)) || false;
        }
        function isNull(value) {
          return value === null;
        }
        function isNumber(value) {
          return typeof value == 'number' || (isObjectLike(value) && objToString.call(value) == numberTag) || false;
        }
        var isPlainObject = !getPrototypeOf ? shimIsPlainObject : function(value) {
          if (!(value && objToString.call(value) == objectTag)) {
            return false;
          }
          var valueOf = value.valueOf,
              objProto = isNative(valueOf) && (objProto = getPrototypeOf(valueOf)) && getPrototypeOf(objProto);
          return objProto ? (value == objProto || getPrototypeOf(value) == objProto) : shimIsPlainObject(value);
        };
        function isRegExp(value) {
          return (isObjectLike(value) && objToString.call(value) == regexpTag) || false;
        }
        function isString(value) {
          return typeof value == 'string' || (isObjectLike(value) && objToString.call(value) == stringTag) || false;
        }
        function isTypedArray(value) {
          return (isObjectLike(value) && isLength(value.length) && typedArrayTags[objToString.call(value)]) || false;
        }
        function isUndefined(value) {
          return typeof value == 'undefined';
        }
        function toArray(value) {
          var length = value ? value.length : 0;
          if (!isLength(length)) {
            return values(value);
          }
          if (!length) {
            return [];
          }
          return arrayCopy(value);
        }
        function toPlainObject(value) {
          return baseCopy(value, keysIn(value));
        }
        var assign = createAssigner(baseAssign);
        function create(prototype, properties, guard) {
          var result = baseCreate(prototype);
          if (guard && isIterateeCall(prototype, properties, guard)) {
            properties = null;
          }
          return properties ? baseCopy(properties, result, keys(properties)) : result;
        }
        function defaults(object) {
          if (object == null) {
            return object;
          }
          var args = arrayCopy(arguments);
          args.push(assignDefaults);
          return assign.apply(undefined, args);
        }
        function findKey(object, predicate, thisArg) {
          predicate = getCallback(predicate, thisArg, 3);
          return baseFind(object, predicate, baseForOwn, true);
        }
        function findLastKey(object, predicate, thisArg) {
          predicate = getCallback(predicate, thisArg, 3);
          return baseFind(object, predicate, baseForOwnRight, true);
        }
        function forIn(object, iteratee, thisArg) {
          if (typeof iteratee != 'function' || typeof thisArg != 'undefined') {
            iteratee = bindCallback(iteratee, thisArg, 3);
          }
          return baseFor(object, iteratee, keysIn);
        }
        function forInRight(object, iteratee, thisArg) {
          iteratee = bindCallback(iteratee, thisArg, 3);
          return baseForRight(object, iteratee, keysIn);
        }
        function forOwn(object, iteratee, thisArg) {
          if (typeof iteratee != 'function' || typeof thisArg != 'undefined') {
            iteratee = bindCallback(iteratee, thisArg, 3);
          }
          return baseForOwn(object, iteratee);
        }
        function forOwnRight(object, iteratee, thisArg) {
          iteratee = bindCallback(iteratee, thisArg, 3);
          return baseForRight(object, iteratee, keys);
        }
        function functions(object) {
          return baseFunctions(object, keysIn(object));
        }
        function has(object, key) {
          return object ? hasOwnProperty.call(object, key) : false;
        }
        function invert(object, multiValue, guard) {
          if (guard && isIterateeCall(object, multiValue, guard)) {
            multiValue = null;
          }
          var index = -1,
              props = keys(object),
              length = props.length,
              result = {};
          while (++index < length) {
            var key = props[index],
                value = object[key];
            if (multiValue) {
              if (hasOwnProperty.call(result, value)) {
                result[value].push(key);
              } else {
                result[value] = [key];
              }
            } else {
              result[value] = key;
            }
          }
          return result;
        }
        var keys = !nativeKeys ? shimKeys : function(object) {
          if (object) {
            var Ctor = object.constructor,
                length = object.length;
          }
          if ((typeof Ctor == 'function' && Ctor.prototype === object) || (typeof object != 'function' && (length && isLength(length)))) {
            return shimKeys(object);
          }
          return isObject(object) ? nativeKeys(object) : [];
        };
        function keysIn(object) {
          if (object == null) {
            return [];
          }
          if (!isObject(object)) {
            object = Object(object);
          }
          var length = object.length;
          length = (length && isLength(length) && (isArray(object) || (support.nonEnumArgs && isArguments(object))) && length) || 0;
          var Ctor = object.constructor,
              index = -1,
              isProto = typeof Ctor == 'function' && Ctor.prototype === object,
              result = Array(length),
              skipIndexes = length > 0;
          while (++index < length) {
            result[index] = (index + '');
          }
          for (var key in object) {
            if (!(skipIndexes && isIndex(key, length)) && !(key == 'constructor' && (isProto || !hasOwnProperty.call(object, key)))) {
              result.push(key);
            }
          }
          return result;
        }
        function mapValues(object, iteratee, thisArg) {
          var result = {};
          iteratee = getCallback(iteratee, thisArg, 3);
          baseForOwn(object, function(value, key, object) {
            result[key] = iteratee(value, key, object);
          });
          return result;
        }
        var merge = createAssigner(baseMerge);
        function omit(object, predicate, thisArg) {
          if (object == null) {
            return {};
          }
          if (typeof predicate != 'function') {
            var props = arrayMap(baseFlatten(arguments, false, false, 1), String);
            return pickByArray(object, baseDifference(keysIn(object), props));
          }
          predicate = bindCallback(predicate, thisArg, 3);
          return pickByCallback(object, function(value, key, object) {
            return !predicate(value, key, object);
          });
        }
        function pairs(object) {
          var index = -1,
              props = keys(object),
              length = props.length,
              result = Array(length);
          while (++index < length) {
            var key = props[index];
            result[index] = [key, object[key]];
          }
          return result;
        }
        function pick(object, predicate, thisArg) {
          if (object == null) {
            return {};
          }
          return typeof predicate == 'function' ? pickByCallback(object, bindCallback(predicate, thisArg, 3)) : pickByArray(object, baseFlatten(arguments, false, false, 1));
        }
        function result(object, key, defaultValue) {
          var value = object == null ? undefined : object[key];
          if (typeof value == 'undefined') {
            value = defaultValue;
          }
          return isFunction(value) ? value.call(object) : value;
        }
        function transform(object, iteratee, accumulator, thisArg) {
          var isArr = isArray(object) || isTypedArray(object);
          iteratee = getCallback(iteratee, thisArg, 4);
          if (accumulator == null) {
            if (isArr || isObject(object)) {
              var Ctor = object.constructor;
              if (isArr) {
                accumulator = isArray(object) ? new Ctor : [];
              } else {
                accumulator = baseCreate(isFunction(Ctor) && Ctor.prototype);
              }
            } else {
              accumulator = {};
            }
          }
          (isArr ? arrayEach : baseForOwn)(object, function(value, index, object) {
            return iteratee(accumulator, value, index, object);
          });
          return accumulator;
        }
        function values(object) {
          return baseValues(object, keys(object));
        }
        function valuesIn(object) {
          return baseValues(object, keysIn(object));
        }
        function random(min, max, floating) {
          if (floating && isIterateeCall(min, max, floating)) {
            max = floating = null;
          }
          var noMin = min == null,
              noMax = max == null;
          if (floating == null) {
            if (noMax && typeof min == 'boolean') {
              floating = min;
              min = 1;
            } else if (typeof max == 'boolean') {
              floating = max;
              noMax = true;
            }
          }
          if (noMin && noMax) {
            max = 1;
            noMax = false;
          }
          min = +min || 0;
          if (noMax) {
            max = min;
            min = 0;
          } else {
            max = +max || 0;
          }
          if (floating || min % 1 || max % 1) {
            var rand = nativeRandom();
            return nativeMin(min + (rand * (max - min + parseFloat('1e-' + ((rand + '').length - 1)))), max);
          }
          return baseRandom(min, max);
        }
        var camelCase = createCompounder(function(result, word, index) {
          word = word.toLowerCase();
          return result + (index ? (word.charAt(0).toUpperCase() + word.slice(1)) : word);
        });
        function capitalize(string) {
          string = baseToString(string);
          return string && (string.charAt(0).toUpperCase() + string.slice(1));
        }
        function deburr(string) {
          string = baseToString(string);
          return string && string.replace(reLatin1, deburrLetter);
        }
        function endsWith(string, target, position) {
          string = baseToString(string);
          target = (target + '');
          var length = string.length;
          position = (typeof position == 'undefined' ? length : nativeMin(position < 0 ? 0 : (+position || 0), length)) - target.length;
          return position >= 0 && string.indexOf(target, position) == position;
        }
        function escape(string) {
          string = baseToString(string);
          return (string && reHasUnescapedHtml.test(string)) ? string.replace(reUnescapedHtml, escapeHtmlChar) : string;
        }
        function escapeRegExp(string) {
          string = baseToString(string);
          return (string && reHasRegExpChars.test(string)) ? string.replace(reRegExpChars, '\\$&') : string;
        }
        var kebabCase = createCompounder(function(result, word, index) {
          return result + (index ? '-' : '') + word.toLowerCase();
        });
        function pad(string, length, chars) {
          string = baseToString(string);
          length = +length;
          var strLength = string.length;
          if (strLength >= length || !nativeIsFinite(length)) {
            return string;
          }
          var mid = (length - strLength) / 2,
              leftLength = floor(mid),
              rightLength = ceil(mid);
          chars = createPad('', rightLength, chars);
          return chars.slice(0, leftLength) + string + chars;
        }
        function padLeft(string, length, chars) {
          string = baseToString(string);
          return string && (createPad(string, length, chars) + string);
        }
        function padRight(string, length, chars) {
          string = baseToString(string);
          return string && (string + createPad(string, length, chars));
        }
        function parseInt(string, radix, guard) {
          if (guard && isIterateeCall(string, radix, guard)) {
            radix = 0;
          }
          return nativeParseInt(string, radix);
        }
        if (nativeParseInt(whitespace + '08') != 8) {
          parseInt = function(string, radix, guard) {
            if (guard ? isIterateeCall(string, radix, guard) : radix == null) {
              radix = 0;
            } else if (radix) {
              radix = +radix;
            }
            string = trim(string);
            return nativeParseInt(string, radix || (reHexPrefix.test(string) ? 16 : 10));
          };
        }
        function repeat(string, n) {
          var result = '';
          string = baseToString(string);
          n = +n;
          if (n < 1 || !string || !nativeIsFinite(n)) {
            return result;
          }
          do {
            if (n % 2) {
              result += string;
            }
            n = floor(n / 2);
            string += string;
          } while (n);
          return result;
        }
        var snakeCase = createCompounder(function(result, word, index) {
          return result + (index ? '_' : '') + word.toLowerCase();
        });
        var startCase = createCompounder(function(result, word, index) {
          return result + (index ? ' ' : '') + (word.charAt(0).toUpperCase() + word.slice(1));
        });
        function startsWith(string, target, position) {
          string = baseToString(string);
          position = position == null ? 0 : nativeMin(position < 0 ? 0 : (+position || 0), string.length);
          return string.lastIndexOf(target, position) == position;
        }
        function template(string, options, otherOptions) {
          var settings = lodash.templateSettings;
          if (otherOptions && isIterateeCall(string, options, otherOptions)) {
            options = otherOptions = null;
          }
          string = baseToString(string);
          options = baseAssign(baseAssign({}, otherOptions || options), settings, assignOwnDefaults);
          var imports = baseAssign(baseAssign({}, options.imports), settings.imports, assignOwnDefaults),
              importsKeys = keys(imports),
              importsValues = baseValues(imports, importsKeys);
          var isEscaping,
              isEvaluating,
              index = 0,
              interpolate = options.interpolate || reNoMatch,
              source = "__p += '";
          var reDelimiters = RegExp((options.escape || reNoMatch).source + '|' + interpolate.source + '|' + (interpolate === reInterpolate ? reEsTemplate : reNoMatch).source + '|' + (options.evaluate || reNoMatch).source + '|$', 'g');
          var sourceURL = '//# sourceURL=' + ('sourceURL' in options ? options.sourceURL : ('lodash.templateSources[' + (++templateCounter) + ']')) + '\n';
          string.replace(reDelimiters, function(match, escapeValue, interpolateValue, esTemplateValue, evaluateValue, offset) {
            interpolateValue || (interpolateValue = esTemplateValue);
            source += string.slice(index, offset).replace(reUnescapedString, escapeStringChar);
            if (escapeValue) {
              isEscaping = true;
              source += "' +\n__e(" + escapeValue + ") +\n'";
            }
            if (evaluateValue) {
              isEvaluating = true;
              source += "';\n" + evaluateValue + ";\n__p += '";
            }
            if (interpolateValue) {
              source += "' +\n((__t = (" + interpolateValue + ")) == null ? '' : __t) +\n'";
            }
            index = offset + match.length;
            return match;
          });
          source += "';\n";
          var variable = options.variable;
          if (!variable) {
            source = 'with (obj) {\n' + source + '\n}\n';
          }
          source = (isEvaluating ? source.replace(reEmptyStringLeading, '') : source).replace(reEmptyStringMiddle, '$1').replace(reEmptyStringTrailing, '$1;');
          source = 'function(' + (variable || 'obj') + ') {\n' + (variable ? '' : 'obj || (obj = {});\n') + "var __t, __p = ''" + (isEscaping ? ', __e = _.escape' : '') + (isEvaluating ? ', __j = Array.prototype.join;\n' + "function print() { __p += __j.call(arguments, '') }\n" : ';\n') + source + 'return __p\n}';
          var result = attempt(function() {
            return Function(importsKeys, sourceURL + 'return ' + source).apply(undefined, importsValues);
          });
          result.source = source;
          if (isError(result)) {
            throw result;
          }
          return result;
        }
        function trim(string, chars, guard) {
          var value = string;
          string = baseToString(string);
          if (!string) {
            return string;
          }
          if (guard ? isIterateeCall(value, chars, guard) : chars == null) {
            return string.slice(trimmedLeftIndex(string), trimmedRightIndex(string) + 1);
          }
          chars = (chars + '');
          return string.slice(charsLeftIndex(string, chars), charsRightIndex(string, chars) + 1);
        }
        function trimLeft(string, chars, guard) {
          var value = string;
          string = baseToString(string);
          if (!string) {
            return string;
          }
          if (guard ? isIterateeCall(value, chars, guard) : chars == null) {
            return string.slice(trimmedLeftIndex(string));
          }
          return string.slice(charsLeftIndex(string, (chars + '')));
        }
        function trimRight(string, chars, guard) {
          var value = string;
          string = baseToString(string);
          if (!string) {
            return string;
          }
          if (guard ? isIterateeCall(value, chars, guard) : chars == null) {
            return string.slice(0, trimmedRightIndex(string) + 1);
          }
          return string.slice(0, charsRightIndex(string, (chars + '')) + 1);
        }
        function trunc(string, options, guard) {
          if (guard && isIterateeCall(string, options, guard)) {
            options = null;
          }
          var length = DEFAULT_TRUNC_LENGTH,
              omission = DEFAULT_TRUNC_OMISSION;
          if (options != null) {
            if (isObject(options)) {
              var separator = 'separator' in options ? options.separator : separator;
              length = 'length' in options ? +options.length || 0 : length;
              omission = 'omission' in options ? baseToString(options.omission) : omission;
            } else {
              length = +options || 0;
            }
          }
          string = baseToString(string);
          if (length >= string.length) {
            return string;
          }
          var end = length - omission.length;
          if (end < 1) {
            return omission;
          }
          var result = string.slice(0, end);
          if (separator == null) {
            return result + omission;
          }
          if (isRegExp(separator)) {
            if (string.slice(end).search(separator)) {
              var match,
                  newEnd,
                  substring = string.slice(0, end);
              if (!separator.global) {
                separator = RegExp(separator.source, (reFlags.exec(separator) || '') + 'g');
              }
              separator.lastIndex = 0;
              while ((match = separator.exec(substring))) {
                newEnd = match.index;
              }
              result = result.slice(0, newEnd == null ? end : newEnd);
            }
          } else if (string.indexOf(separator, end) != end) {
            var index = result.lastIndexOf(separator);
            if (index > -1) {
              result = result.slice(0, index);
            }
          }
          return result + omission;
        }
        function unescape(string) {
          string = baseToString(string);
          return (string && reHasEscapedHtml.test(string)) ? string.replace(reEscapedHtml, unescapeHtmlChar) : string;
        }
        function words(string, pattern, guard) {
          if (guard && isIterateeCall(string, pattern, guard)) {
            pattern = null;
          }
          string = baseToString(string);
          return string.match(pattern || reWords) || [];
        }
        function attempt(func) {
          try {
            return func.apply(undefined, baseSlice(arguments, 1));
          } catch (e) {
            return isError(e) ? e : new Error(e);
          }
        }
        function callback(func, thisArg, guard) {
          if (guard && isIterateeCall(func, thisArg, guard)) {
            thisArg = null;
          }
          return isObjectLike(func) ? matches(func) : baseCallback(func, thisArg);
        }
        function constant(value) {
          return function() {
            return value;
          };
        }
        function identity(value) {
          return value;
        }
        function matches(source) {
          return baseMatches(baseClone(source, true));
        }
        function matchesProperty(key, value) {
          return baseMatchesProperty(key + '', baseClone(value, true));
        }
        function mixin(object, source, options) {
          if (options == null) {
            var isObj = isObject(source),
                props = isObj && keys(source),
                methodNames = props && props.length && baseFunctions(source, props);
            if (!(methodNames ? methodNames.length : isObj)) {
              methodNames = false;
              options = source;
              source = object;
              object = this;
            }
          }
          if (!methodNames) {
            methodNames = baseFunctions(source, keys(source));
          }
          var chain = true,
              index = -1,
              isFunc = isFunction(object),
              length = methodNames.length;
          if (options === false) {
            chain = false;
          } else if (isObject(options) && 'chain' in options) {
            chain = options.chain;
          }
          while (++index < length) {
            var methodName = methodNames[index],
                func = source[methodName];
            object[methodName] = func;
            if (isFunc) {
              object.prototype[methodName] = (function(func) {
                return function() {
                  var chainAll = this.__chain__;
                  if (chain || chainAll) {
                    var result = object(this.__wrapped__);
                    (result.__actions__ = arrayCopy(this.__actions__)).push({
                      'func': func,
                      'args': arguments,
                      'thisArg': object
                    });
                    result.__chain__ = chainAll;
                    return result;
                  }
                  var args = [this.value()];
                  push.apply(args, arguments);
                  return func.apply(object, args);
                };
              }(func));
            }
          }
          return object;
        }
        function noConflict() {
          context._ = oldDash;
          return this;
        }
        function noop() {}
        function property(key) {
          return baseProperty(key + '');
        }
        function propertyOf(object) {
          return function(key) {
            return object == null ? undefined : object[key];
          };
        }
        function range(start, end, step) {
          if (step && isIterateeCall(start, end, step)) {
            end = step = null;
          }
          start = +start || 0;
          step = step == null ? 1 : (+step || 0);
          if (end == null) {
            end = start;
            start = 0;
          } else {
            end = +end || 0;
          }
          var index = -1,
              length = nativeMax(ceil((end - start) / (step || 1)), 0),
              result = Array(length);
          while (++index < length) {
            result[index] = start;
            start += step;
          }
          return result;
        }
        function times(n, iteratee, thisArg) {
          n = +n;
          if (n < 1 || !nativeIsFinite(n)) {
            return [];
          }
          var index = -1,
              result = Array(nativeMin(n, MAX_ARRAY_LENGTH));
          iteratee = bindCallback(iteratee, thisArg, 1);
          while (++index < n) {
            if (index < MAX_ARRAY_LENGTH) {
              result[index] = iteratee(index);
            } else {
              iteratee(index);
            }
          }
          return result;
        }
        function uniqueId(prefix) {
          var id = ++idCounter;
          return baseToString(prefix) + id;
        }
        LodashWrapper.prototype = baseCreate(lodash.prototype);
        LazyWrapper.prototype = baseCreate(LodashWrapper.prototype);
        LazyWrapper.prototype.constructor = LazyWrapper;
        MapCache.prototype['delete'] = mapDelete;
        MapCache.prototype.get = mapGet;
        MapCache.prototype.has = mapHas;
        MapCache.prototype.set = mapSet;
        SetCache.prototype.push = cachePush;
        memoize.Cache = MapCache;
        lodash.after = after;
        lodash.ary = ary;
        lodash.assign = assign;
        lodash.at = at;
        lodash.before = before;
        lodash.bind = bind;
        lodash.bindAll = bindAll;
        lodash.bindKey = bindKey;
        lodash.callback = callback;
        lodash.chain = chain;
        lodash.chunk = chunk;
        lodash.compact = compact;
        lodash.constant = constant;
        lodash.countBy = countBy;
        lodash.create = create;
        lodash.curry = curry;
        lodash.curryRight = curryRight;
        lodash.debounce = debounce;
        lodash.defaults = defaults;
        lodash.defer = defer;
        lodash.delay = delay;
        lodash.difference = difference;
        lodash.drop = drop;
        lodash.dropRight = dropRight;
        lodash.dropRightWhile = dropRightWhile;
        lodash.dropWhile = dropWhile;
        lodash.fill = fill;
        lodash.filter = filter;
        lodash.flatten = flatten;
        lodash.flattenDeep = flattenDeep;
        lodash.flow = flow;
        lodash.flowRight = flowRight;
        lodash.forEach = forEach;
        lodash.forEachRight = forEachRight;
        lodash.forIn = forIn;
        lodash.forInRight = forInRight;
        lodash.forOwn = forOwn;
        lodash.forOwnRight = forOwnRight;
        lodash.functions = functions;
        lodash.groupBy = groupBy;
        lodash.indexBy = indexBy;
        lodash.initial = initial;
        lodash.intersection = intersection;
        lodash.invert = invert;
        lodash.invoke = invoke;
        lodash.keys = keys;
        lodash.keysIn = keysIn;
        lodash.map = map;
        lodash.mapValues = mapValues;
        lodash.matches = matches;
        lodash.matchesProperty = matchesProperty;
        lodash.memoize = memoize;
        lodash.merge = merge;
        lodash.mixin = mixin;
        lodash.negate = negate;
        lodash.omit = omit;
        lodash.once = once;
        lodash.pairs = pairs;
        lodash.partial = partial;
        lodash.partialRight = partialRight;
        lodash.partition = partition;
        lodash.pick = pick;
        lodash.pluck = pluck;
        lodash.property = property;
        lodash.propertyOf = propertyOf;
        lodash.pull = pull;
        lodash.pullAt = pullAt;
        lodash.range = range;
        lodash.rearg = rearg;
        lodash.reject = reject;
        lodash.remove = remove;
        lodash.rest = rest;
        lodash.shuffle = shuffle;
        lodash.slice = slice;
        lodash.sortBy = sortBy;
        lodash.sortByAll = sortByAll;
        lodash.spread = spread;
        lodash.take = take;
        lodash.takeRight = takeRight;
        lodash.takeRightWhile = takeRightWhile;
        lodash.takeWhile = takeWhile;
        lodash.tap = tap;
        lodash.throttle = throttle;
        lodash.thru = thru;
        lodash.times = times;
        lodash.toArray = toArray;
        lodash.toPlainObject = toPlainObject;
        lodash.transform = transform;
        lodash.union = union;
        lodash.uniq = uniq;
        lodash.unzip = unzip;
        lodash.values = values;
        lodash.valuesIn = valuesIn;
        lodash.where = where;
        lodash.without = without;
        lodash.wrap = wrap;
        lodash.xor = xor;
        lodash.zip = zip;
        lodash.zipObject = zipObject;
        lodash.backflow = flowRight;
        lodash.collect = map;
        lodash.compose = flowRight;
        lodash.each = forEach;
        lodash.eachRight = forEachRight;
        lodash.extend = assign;
        lodash.iteratee = callback;
        lodash.methods = functions;
        lodash.object = zipObject;
        lodash.select = filter;
        lodash.tail = rest;
        lodash.unique = uniq;
        mixin(lodash, lodash);
        lodash.attempt = attempt;
        lodash.camelCase = camelCase;
        lodash.capitalize = capitalize;
        lodash.clone = clone;
        lodash.cloneDeep = cloneDeep;
        lodash.deburr = deburr;
        lodash.endsWith = endsWith;
        lodash.escape = escape;
        lodash.escapeRegExp = escapeRegExp;
        lodash.every = every;
        lodash.find = find;
        lodash.findIndex = findIndex;
        lodash.findKey = findKey;
        lodash.findLast = findLast;
        lodash.findLastIndex = findLastIndex;
        lodash.findLastKey = findLastKey;
        lodash.findWhere = findWhere;
        lodash.first = first;
        lodash.has = has;
        lodash.identity = identity;
        lodash.includes = includes;
        lodash.indexOf = indexOf;
        lodash.isArguments = isArguments;
        lodash.isArray = isArray;
        lodash.isBoolean = isBoolean;
        lodash.isDate = isDate;
        lodash.isElement = isElement;
        lodash.isEmpty = isEmpty;
        lodash.isEqual = isEqual;
        lodash.isError = isError;
        lodash.isFinite = isFinite;
        lodash.isFunction = isFunction;
        lodash.isMatch = isMatch;
        lodash.isNaN = isNaN;
        lodash.isNative = isNative;
        lodash.isNull = isNull;
        lodash.isNumber = isNumber;
        lodash.isObject = isObject;
        lodash.isPlainObject = isPlainObject;
        lodash.isRegExp = isRegExp;
        lodash.isString = isString;
        lodash.isTypedArray = isTypedArray;
        lodash.isUndefined = isUndefined;
        lodash.kebabCase = kebabCase;
        lodash.last = last;
        lodash.lastIndexOf = lastIndexOf;
        lodash.max = max;
        lodash.min = min;
        lodash.noConflict = noConflict;
        lodash.noop = noop;
        lodash.now = now;
        lodash.pad = pad;
        lodash.padLeft = padLeft;
        lodash.padRight = padRight;
        lodash.parseInt = parseInt;
        lodash.random = random;
        lodash.reduce = reduce;
        lodash.reduceRight = reduceRight;
        lodash.repeat = repeat;
        lodash.result = result;
        lodash.runInContext = runInContext;
        lodash.size = size;
        lodash.snakeCase = snakeCase;
        lodash.some = some;
        lodash.sortedIndex = sortedIndex;
        lodash.sortedLastIndex = sortedLastIndex;
        lodash.startCase = startCase;
        lodash.startsWith = startsWith;
        lodash.template = template;
        lodash.trim = trim;
        lodash.trimLeft = trimLeft;
        lodash.trimRight = trimRight;
        lodash.trunc = trunc;
        lodash.unescape = unescape;
        lodash.uniqueId = uniqueId;
        lodash.words = words;
        lodash.all = every;
        lodash.any = some;
        lodash.contains = includes;
        lodash.detect = find;
        lodash.foldl = reduce;
        lodash.foldr = reduceRight;
        lodash.head = first;
        lodash.include = includes;
        lodash.inject = reduce;
        mixin(lodash, (function() {
          var source = {};
          baseForOwn(lodash, function(func, methodName) {
            if (!lodash.prototype[methodName]) {
              source[methodName] = func;
            }
          });
          return source;
        }()), false);
        lodash.sample = sample;
        lodash.prototype.sample = function(n) {
          if (!this.__chain__ && n == null) {
            return sample(this.value());
          }
          return this.thru(function(value) {
            return sample(value, n);
          });
        };
        lodash.VERSION = VERSION;
        arrayEach(['bind', 'bindKey', 'curry', 'curryRight', 'partial', 'partialRight'], function(methodName) {
          lodash[methodName].placeholder = lodash;
        });
        arrayEach(['filter', 'map', 'takeWhile'], function(methodName, index) {
          var isFilter = index == LAZY_FILTER_FLAG,
              isWhile = index == LAZY_WHILE_FLAG;
          LazyWrapper.prototype[methodName] = function(iteratee, thisArg) {
            var result = this.clone(),
                filtered = result.__filtered__,
                iteratees = result.__iteratees__ || (result.__iteratees__ = []);
            result.__filtered__ = filtered || isFilter || (isWhile && result.__dir__ < 0);
            iteratees.push({
              'iteratee': getCallback(iteratee, thisArg, 3),
              'type': index
            });
            return result;
          };
        });
        arrayEach(['drop', 'take'], function(methodName, index) {
          var countName = '__' + methodName + 'Count__',
              whileName = methodName + 'While';
          LazyWrapper.prototype[methodName] = function(n) {
            n = n == null ? 1 : nativeMax(floor(n) || 0, 0);
            var result = this.clone();
            if (result.__filtered__) {
              var value = result[countName];
              result[countName] = index ? nativeMin(value, n) : (value + n);
            } else {
              var views = result.__views__ || (result.__views__ = []);
              views.push({
                'size': n,
                'type': methodName + (result.__dir__ < 0 ? 'Right' : '')
              });
            }
            return result;
          };
          LazyWrapper.prototype[methodName + 'Right'] = function(n) {
            return this.reverse()[methodName](n).reverse();
          };
          LazyWrapper.prototype[methodName + 'RightWhile'] = function(predicate, thisArg) {
            return this.reverse()[whileName](predicate, thisArg).reverse();
          };
        });
        arrayEach(['first', 'last'], function(methodName, index) {
          var takeName = 'take' + (index ? 'Right' : '');
          LazyWrapper.prototype[methodName] = function() {
            return this[takeName](1).value()[0];
          };
        });
        arrayEach(['initial', 'rest'], function(methodName, index) {
          var dropName = 'drop' + (index ? '' : 'Right');
          LazyWrapper.prototype[methodName] = function() {
            return this[dropName](1);
          };
        });
        arrayEach(['pluck', 'where'], function(methodName, index) {
          var operationName = index ? 'filter' : 'map',
              createCallback = index ? baseMatches : baseProperty;
          LazyWrapper.prototype[methodName] = function(value) {
            return this[operationName](createCallback(value));
          };
        });
        LazyWrapper.prototype.compact = function() {
          return this.filter(identity);
        };
        LazyWrapper.prototype.dropWhile = function(iteratee, thisArg) {
          var done;
          iteratee = getCallback(iteratee, thisArg, 3);
          return this.filter(function(value, index, array) {
            return done || (done = !iteratee(value, index, array));
          });
        };
        LazyWrapper.prototype.reject = function(iteratee, thisArg) {
          iteratee = getCallback(iteratee, thisArg, 3);
          return this.filter(function(value, index, array) {
            return !iteratee(value, index, array);
          });
        };
        LazyWrapper.prototype.slice = function(start, end) {
          start = start == null ? 0 : (+start || 0);
          var result = start < 0 ? this.takeRight(-start) : this.drop(start);
          if (typeof end != 'undefined') {
            end = (+end || 0);
            result = end < 0 ? result.dropRight(-end) : result.take(end - start);
          }
          return result;
        };
        LazyWrapper.prototype.toArray = function() {
          return this.drop(0);
        };
        baseForOwn(LazyWrapper.prototype, function(func, methodName) {
          var lodashFunc = lodash[methodName],
              retUnwrapped = /^(?:first|last)$/.test(methodName);
          lodash.prototype[methodName] = function() {
            var value = this.__wrapped__,
                args = arguments,
                chainAll = this.__chain__,
                isHybrid = !!this.__actions__.length,
                isLazy = value instanceof LazyWrapper,
                onlyLazy = isLazy && !isHybrid;
            if (retUnwrapped && !chainAll) {
              return onlyLazy ? func.call(value) : lodashFunc.call(lodash, this.value());
            }
            var interceptor = function(value) {
              var otherArgs = [value];
              push.apply(otherArgs, args);
              return lodashFunc.apply(lodash, otherArgs);
            };
            if (isLazy || isArray(value)) {
              var wrapper = onlyLazy ? value : new LazyWrapper(this),
                  result = func.apply(wrapper, args);
              if (!retUnwrapped && (isHybrid || result.__actions__)) {
                var actions = result.__actions__ || (result.__actions__ = []);
                actions.push({
                  'func': thru,
                  'args': [interceptor],
                  'thisArg': lodash
                });
              }
              return new LodashWrapper(result, chainAll);
            }
            return this.thru(interceptor);
          };
        });
        arrayEach(['concat', 'join', 'pop', 'push', 'shift', 'sort', 'splice', 'unshift'], function(methodName) {
          var func = arrayProto[methodName],
              chainName = /^(?:push|sort|unshift)$/.test(methodName) ? 'tap' : 'thru',
              retUnwrapped = /^(?:join|pop|shift)$/.test(methodName);
          lodash.prototype[methodName] = function() {
            var args = arguments;
            if (retUnwrapped && !this.__chain__) {
              return func.apply(this.value(), args);
            }
            return this[chainName](function(value) {
              return func.apply(value, args);
            });
          };
        });
        LazyWrapper.prototype.clone = lazyClone;
        LazyWrapper.prototype.reverse = lazyReverse;
        LazyWrapper.prototype.value = lazyValue;
        lodash.prototype.chain = wrapperChain;
        lodash.prototype.commit = wrapperCommit;
        lodash.prototype.plant = wrapperPlant;
        lodash.prototype.reverse = wrapperReverse;
        lodash.prototype.toString = wrapperToString;
        lodash.prototype.run = lodash.prototype.toJSON = lodash.prototype.valueOf = lodash.prototype.value = wrapperValue;
        lodash.prototype.collect = lodash.prototype.map;
        lodash.prototype.head = lodash.prototype.first;
        lodash.prototype.select = lodash.prototype.filter;
        lodash.prototype.tail = lodash.prototype.rest;
        return lodash;
      }
      var _ = runInContext();
      if (typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
        root._ = _;
        define(function() {
          return _;
        });
      } else if (freeExports && freeModule) {
        if (moduleExports) {
          (freeModule.exports = _)._ = _;
        } else {
          freeExports._ = _;
        }
      } else {
        root._ = _;
      }
    }.call(this));
  })(require("github:jspm/nodelibs-process@0.1.1"));
  global.define = __define;
  return module.exports;
});



System.register("npm:promise@6.1.0", ["npm:promise@6.1.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:promise@6.1.0/index");
  global.define = __define;
  return module.exports;
});



System.register("npm:lodash@3.2.0", ["npm:lodash@3.2.0/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:lodash@3.2.0/index");
  global.define = __define;
  return module.exports;
});



System.register("npm:google-maps-api@1.0.2/index", ["npm:scriptjs@2.5.7", "npm:promise@6.1.0"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var script = require("npm:scriptjs@2.5.7"),
      promise = require("npm:promise@6.1.0");
  var maps = null,
      callBacks = [],
      key;
  window.$$mapsCB = function() {
    maps = google.maps;
    for (var i = 0,
        len = callBacks.length; i < len; i++) {
      resolve.apply(undefined, callBacks[i]);
    }
  };
  function resolve(onOk, onErr, onComplete, err) {
    if (!err) {
      onOk(maps);
      if (onComplete)
        onComplete(undefined, maps);
    } else {
      onErr(err);
      if (onComplete)
        onComplete(err);
    }
  }
  module.exports = function(apikey, onComplete) {
    key = apikey || key;
    return function() {
      return new promise(function(onOk, onErr) {
        if (!key) {
          resolve(onOk, onErr, onComplete, new Error('No API key passed to require(\'google-maps-api\')'));
        } else {
          if (maps) {
            resolve(onOk, onErr, onComplete);
          } else {
            callBacks.push([onOk, onErr, onComplete]);
            if (callBacks.length == 1) {
              script('https://maps.googleapis.com/maps/api/js?callback=$$mapsCB&key=' + key);
            }
          }
        }
      });
    };
  };
  global.define = __define;
  return module.exports;
});



System.register("app/nav", ["github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], function (_export) {
	"use strict";

	var $, _, lg, $nav_menu, $nav_link, menu_state, active_menu;
	return {
		setters: [function (_githubComponentsJquery213) {
			$ = _githubComponentsJquery213["default"];
		}, function (_npmLodash320) {
			_ = _npmLodash320["default"];
		}, function (_appQuickLog) {
			lg = _appQuickLog.lg;
		}],
		execute: function () {
			// ====================================
			// Desktop Navigation

			$nav_menu = $(".nav_menu");
			$nav_link = $(".nav-level-1 li");
			// The nav buttons

			menu_state = 0;
			active_menu = "";
			// The currently active menu

			if ($nav_menu.length) {
				(function () {
					var show_menu =

					// Show menu function
					function () {
						$nav_menu.hide();
						$("." + active_menu).show();
						menu_state = 1;
						lg("menu {blue{shown}}: {purple{" + active_menu + "}}");
					};

					var hide_menu =

					// Hide menu function
					function () {
						if (menu_state === 1) {
							$nav_menu.hide();
							menu_state = 0;
							lg("all menus {blue{hidden}}");
						}
					};

					// Debounce functions to tweak interaction timing
					var debounce_show_menu = _.debounce(show_menu, 300),
					    debounce_hide_menu = _.debounce(hide_menu, 150);

					// Nav menu buttons
					$nav_link.on("mouseenter", function () {
						debounce_hide_menu.cancel();
						active_menu = $(this).attr("data-menu");
						if (menu_state === 0) {
							debounce_show_menu();
						} else if (menu_state === 1) {
							show_menu();
						}
					}).on("mouseleave", function () {
						debounce_show_menu.cancel();
						debounce_hide_menu();
					});

					// Nav menus
					$nav_menu.on("mouseenter", function () {
						debounce_hide_menu.cancel();
					}).on("mouseleave", function () {
						debounce_show_menu.cancel();
						debounce_hide_menu();
					});

					// ====================================
					// Mobile Navigation

					var $nav_menu_mobile = $(".nav_menu_mobile"),
					    // The hidden mobile nav menu
					$nav_mobile_link = $(".nav-mobile_menu"); // The mobile nav button

					$nav_mobile_link.on("click", function (e) {
						e.preventDefault();
						$nav_menu_mobile.toggle();
						$(this).toggleClass("active");
					});
				})();
			}

			lg("nav {blue{loaded}}");
		}
	};
});

// ====================================
// Navigation Menus

// The hidden nav menus
// 0: hidden, 1: visible. This will let us know if any menu is visible.
System.register("npm:google-maps-api@1.0.2", ["npm:google-maps-api@1.0.2/index"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  module.exports = require("npm:google-maps-api@1.0.2/index");
  global.define = __define;
  return module.exports;
});



System.register("app/map", ["npm:google-maps-api@1.0.2", "github:components/jquery@2.1.3", "npm:lodash@3.2.0", "app/quick-log"], true, function(require, exports, module) {
  var global = System.global,
      __define = global.define;
  global.define = undefined;
  var mapsapi = require("npm:google-maps-api@1.0.2")('AIzaSyCGWW2JRZEhQoygvFrOntDpQjftGKaaudQ');
  var $ = require("github:components/jquery@2.1.3");
  var _ = require("npm:lodash@3.2.0");
  var lg = require("app/quick-log");
  if ($('#map-canvas').length) {
    mapsapi().then(function(maps) {
      function initialize() {
        var myLatlng = new google.maps.LatLng(34.1468759, -118.2554708);
        var mapOptions = {
          zoom: 14,
          center: myLatlng
        };
        var map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions);
        lg.lg('# {purple{maps api}} {orange{loaded}}');
        map.setOptions({'scrollwheel': false});
        var marker = new google.maps.Marker({
          position: myLatlng,
          map: map
        });
        marker.setMap(map);
      }
      initialize();
    });
  }
  lg.lg('map {blue{loaded}}');
  global.define = __define;
  return module.exports;
});



System.register("app/main", ["app/quick-log", "app/nav", "app/modal", "app/tooltip", "app/tab", "app/nav-search", "app/forms", "app/skrollr", "app/carousel", "app/autosuggest", "app/date-picker", "app/form-buttons", "app/form-custom", "app/map"], function (_export) {
													"use strict";

													var lg;
													return {
																										setters: [function (_appQuickLog) {
																																							lg = _appQuickLog.lg;
																										}, function (_appNav) {}, function (_appModal) {}, function (_appTooltip) {}, function (_appTab) {}, function (_appNavSearch) {}, function (_appForms) {}, function (_appSkrollr) {}, function (_appCarousel) {}, function (_appAutosuggest) {}, function (_appDatePicker) {}, function (_appFormButtons) {}, function (_appFormCustom) {}, function (_appVideo) {}, function (_appMap) {}],
																										execute: function () {
																																							lg("{orange{main loaded}}");
																										}
													};
});

// Global


// Components
});
//# sourceMappingURL=main.js.map