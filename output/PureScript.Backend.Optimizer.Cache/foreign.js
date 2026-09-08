import v8 from 'v8';
import fs from 'fs';
import path from 'path';

import * as Semantics from '../PureScript.Backend.Optimizer.Semantics/index.js';
import * as Syntax from '../PureScript.Backend.Optimizer.Syntax/index.js';
import * as CoreFn from '../PureScript.Backend.Optimizer.CoreFn/index.js';
import * as Analysis from '../PureScript.Backend.Optimizer.Analysis/index.js';
import * as DataMap from '../Data.Map.Internal/index.js';
import * as DataTuple from '../Data.Tuple/index.js';
import * as DataMaybe from '../Data.Maybe/index.js';
import * as DataEither from '../Data.Either/index.js';
import * as DataList from '../Data.List.Types/index.js';
import * as DataNonEmptyArray from '../Data.Array.NonEmpty.Internal/index.js';

// Global registry of all PureScript constructors used in the AST
const registry = {};

function registerModule(prefix, mod) {
  for (const key in mod) {
    const val = mod[key];
    // PureScript constructors are usually exported as functions with uppercase names
    if (typeof val === 'function' && key[0] === key[0].toUpperCase()) {
      const tag = prefix + "$" + key;
      val.prototype.__psTag = tag;
      registry[tag] = val;
    }
  }
}

registerModule('Semantics', Semantics);
registerModule('Syntax', Syntax);
registerModule('CoreFn', CoreFn);
registerModule('Analysis', Analysis);
registerModule('DataMap', DataMap);
registerModule('DataTuple', DataTuple);
registerModule('DataMaybe', DataMaybe);
registerModule('DataEither', DataEither);
registerModule('DataList', DataList);
registerModule('DataNonEmptyArray', DataNonEmptyArray);

const VISITED_KEY = Symbol('visited_key');

// Custom serializer that saves the constructor name
function serialize(val) {
  const cleanup = [];

  function walk(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (obj[VISITED_KEY] !== undefined) {
      return obj[VISITED_KEY];
    }
    
    if (Array.isArray(obj)) {
      const arr = [];
      obj[VISITED_KEY] = arr;
      cleanup.push(obj);
      for (let i = 0; i < obj.length; i++) {
        arr[i] = walk(obj[i]);
      }
      return arr;
    }
    
    const tag = obj.__psTag;
    const isPureScriptCtor = tag && registry[tag];
    
    const res = isPureScriptCtor ? { __ps: tag } : {};
    obj[VISITED_KEY] = res;
    cleanup.push(obj);
    
    for (const key of Object.keys(obj)) {
      res[key] = walk(obj[key]);
    }
    
    return res;
  }
  
  const walked = walk(val);
  
  // Clean up the symbol properties
  for (let i = 0; i < cleanup.length; i++) {
    delete cleanup[i][VISITED_KEY];
  }
  
  return v8.serialize(walked);
}

// Custom deserializer that restores the prototypes
function deserialize(buffer) {
  const parsed = v8.deserialize(buffer);
  
  function walk(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        obj[i] = walk(obj[i]);
      }
      return obj;
    }
    
    if (obj.__ps && registry[obj.__ps]) {
      const ctor = registry[obj.__ps];
      const res = Object.create(ctor.prototype);
      for (const key of Object.keys(obj)) {
        if (key !== '__ps') {
          res[key] = walk(obj[key]);
        }
      }
      return res;
    }
    
    for (const key of Object.keys(obj)) {
      obj[key] = walk(obj[key]);
    }
    
    return obj;
  }
  
  return walk(parsed);
}

// In-memory cache to avoid re-reading the same file
const ramCache = new Map();

export const writePurmetaSyncImpl = function(moduleName) {
  return function(data) {
    return function() {
      const dir = '.purmeta';
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, moduleName + '.purmeta');
      const buffer = serialize(data);
      fs.writeFileSync(filePath, buffer);
      
      // Store in LRU / RAM temporarily just in case
      ramCache.set(moduleName, data);
    };
  };
};

export const readPurmetaSyncImpl = function(moduleName) {
  return function(just) {
    return function(nothing) {
      return function() {
        if (ramCache.has(moduleName)) {
          return just(ramCache.get(moduleName));
        }
        
        const filePath = path.join('.purmeta', moduleName + '.purmeta');
        if (!fs.existsSync(filePath)) {
          return nothing;
        }
        
        try {
          const buffer = fs.readFileSync(filePath);
          const data = deserialize(buffer);
          ramCache.set(moduleName, data);
          return just(data);
        } catch (e) {
          console.error("Failed to read purmeta for " + moduleName + ": " + e.message);
          return nothing;
        }
      };
    };
  };
};

let baselineRss = 0;

export const clearPurmetaCacheImpl = function() {
  ramCache.clear();
  if (global.gc) {
    const currentRss = process.memoryUsage().rss;
    const diffRss = currentRss - baselineRss;
    
    // If RSS has grown by more than 1GB since the last GC, force GC to release memory to OS
    if (diffRss > 1024 * 1024 * 1024) { 
      global.gc();
      console.log('CALLED GLOBAL GC');
      baselineRss = process.memoryUsage().rss; 
    }
  }
};

export const logMemoryImpl = function(label) {
  return function() {
    // GC is now managed in clearPurmetaCacheImpl, no forced GC here
    const mem = process.memoryUsage();
    console.log(`[Memory - ${label}] HeapUsed: ${Math.round(mem.heapUsed / 1024 / 1024)} MB | RSS: ${Math.round(mem.rss / 1024 / 1024)} MB`);
  };
};
