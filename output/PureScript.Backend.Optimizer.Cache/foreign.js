import v8 from 'v8';
import { performance } from 'node:perf_hooks';
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

// Private, unversioned V8 scratch payloads for the current build only.
// Directory, codec and invalidation contract: docs/purmeta-cache.md.

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

// The byte budget describes serialized payloads, not decoded JavaScript heap.
// Trim only between modules, preserving reuse throughout one module's work.
let maxRamCacheBytes = 64 * 1024 * 1024;
const ramCache = new Map();
let ramCacheBytes = 0;
// Start with an empty scope: a direct lookup before the first builder call
// must not treat files left by another process as validated implementations.
let currentBuildModules = new Set();
let purmetaStats = null;

// A caller can scope an override using the returned previous budget. Changing
// the limit never evicts mid-module; trimPurmetaCache applies it at a boundary.
export const setPurmetaCacheBudgetBytes = bytes => () => {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError('PBO purmeta cache budget must be a non-negative safe integer byte count');
  }
  const previous = maxRamCacheBytes;
  maxRamCacheBytes = bytes;
  return previous;
};

function newPurmetaStats() {
  return {
    reads: {
      requests: 0, blocked: 0, ramHits: 0, ramMisses: 0,
      diskHits: 0, diskMissing: 0, errors: 0,
      ioAttempts: 0, files: 0, bytes: 0, ioMs: 0,
      deserializations: 0, deserializeMs: 0,
    },
    writes: { attempts: 0, files: 0, bytes: 0, errors: 0, ioMs: 0, serializations: 0, serializeMs: 0 },
    ram: {
      peakEntries: ramCache.size, peakSerializedBytes: ramCacheBytes,
      boundaryPeakEntries: 0, boundaryPeakSerializedBytes: 0,
      trimCalls: 0, evictions: 0, evictedBytes: 0,
      clearCalls: 0, clearedEntries: 0, clearedBytes: 0,
    },
    rssBytesAtStart: process.memoryUsage().rss,
  };
}

// Called only while profiling, including on failure. Serialization timings
// include the constructor graph walks, not just v8.serialize/deserialize.
function timed(stats, field, action) {
  const start = performance.now();
  try { return action(); }
  finally { stats[field] += performance.now() - start; }
}

export const setPurmetaStatsEnabled = enabled => () => {
  purmetaStats = enabled ? newPurmetaStats() : null;
};

export const readPurmetaStatsJson = () => {
  if (purmetaStats === null) return 'null';
  const { rssBytesAtStart, ...stats } = purmetaStats;
  return JSON.stringify({
    schema: 1,
    policy: { kind: 'lru-module-boundary', maxSerializedBytes: maxRamCacheBytes },
    ...stats,
    ram: { ...stats.ram, entries: ramCache.size, serializedBytes: ramCacheBytes },
    memory: {
      rssBytesAtStart, rssBytesAtSnapshot: process.memoryUsage().rss,
      // OS high-water mark for the entire process, including earlier phases.
      processPeakRSSKiB: process.resourceUsage().maxRSS,
    },
  });
};

function rememberModule(moduleName, data, bytes) {
  const previous = ramCache.get(moduleName);
  if (previous !== undefined) {
    ramCacheBytes -= previous.bytes;
    ramCache.delete(moduleName);
  }
  ramCache.set(moduleName, { data, bytes });
  ramCacheBytes += bytes;
  if (purmetaStats !== null) {
    purmetaStats.ram.peakEntries = Math.max(purmetaStats.ram.peakEntries, ramCache.size);
    purmetaStats.ram.peakSerializedBytes = Math.max(purmetaStats.ram.peakSerializedBytes, ramCacheBytes);
  }
}

// Specialized implementations are valid only for the build that emitted them.
// Forward references must not load a previous build's specialization names.
export const beginPurmetaBuild = function() {
  ramCache.clear();
  ramCacheBytes = 0;
  currentBuildModules = new Set();
  if (purmetaStats !== null) purmetaStats = newPurmetaStats();
};

export const writePurmetaSyncImpl = function(moduleName) {
  return function(data) {
    return function() {
      const stats = purmetaStats;
      if (stats !== null) stats.writes.attempts++;
      try {
        const dir = '.purmeta';
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const filePath = path.join(dir, moduleName + '.purmeta');
        if (stats !== null) stats.writes.serializations++;
        const buffer = stats === null ? serialize(data) : timed(stats.writes, 'serializeMs', () => serialize(data));
        if (stats === null) fs.writeFileSync(filePath, buffer);
        else {
          timed(stats.writes, 'ioMs', () => fs.writeFileSync(filePath, buffer));
          stats.writes.files++;
          stats.writes.bytes += buffer.byteLength;
        }
        currentBuildModules.add(moduleName);

        rememberModule(moduleName, data, buffer.byteLength);
      } catch (error) {
        if (stats !== null) stats.writes.errors++;
        throw error;
      }
    };
  };
};

export const readPurmetaSyncImpl = function(moduleName) {
  return function(just) {
    return function(nothing) {
      return function() {
        const stats = purmetaStats;
        if (stats !== null) stats.reads.requests++;
        if (!currentBuildModules.has(moduleName)) {
          if (stats !== null) stats.reads.blocked++;
          return nothing;
        }
        const cached = ramCache.get(moduleName);
        if (cached !== undefined) {
          if (stats !== null) stats.reads.ramHits++;
          ramCache.delete(moduleName);
          ramCache.set(moduleName, cached);
          return just(cached.data);
        }
        if (stats !== null) stats.reads.ramMisses++;
        
        const filePath = path.join('.purmeta', moduleName + '.purmeta');
        if (!fs.existsSync(filePath)) {
          if (stats !== null) stats.reads.diskMissing++;
          return nothing;
        }
        
        try {
          if (stats !== null) stats.reads.ioAttempts++;
          const buffer = stats === null ? fs.readFileSync(filePath) : timed(stats.reads, 'ioMs', () => fs.readFileSync(filePath));
          if (stats !== null) {
            stats.reads.files++;
            stats.reads.bytes += buffer.byteLength;
            stats.reads.deserializations++;
          }
          const data = stats === null ? deserialize(buffer) : timed(stats.reads, 'deserializeMs', () => deserialize(buffer));
          rememberModule(moduleName, data, buffer.byteLength);
          if (stats !== null) stats.reads.diskHits++;
          return just(data);
        } catch (e) {
          if (stats !== null) stats.reads.errors++;
          console.error("Failed to read purmeta for " + moduleName + ": " + e.message);
          return nothing;
        }
      };
    };
  };
};

let baselineRss = 0;

function maybeCollectGarbage() {
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
}

// Cumulative allocation profile. The Native bootstrap implements this with
// runtime/pprof; the JavaScript backend has no equivalent sampling hook.
export const nowMillis = () => performance.now();

export const writeAllocProfileImpl = function(path) {
  return function() {
    console.log('[Cache] allocation profile requested (unsupported in JS): ' + path);
  };
};

export const clearPurmetaCacheImpl = function() {
  if (purmetaStats !== null) {
    purmetaStats.ram.clearCalls++;
    purmetaStats.ram.clearedEntries += ramCache.size;
    purmetaStats.ram.clearedBytes += ramCacheBytes;
  }
  ramCache.clear();
  ramCacheBytes = 0;
  maybeCollectGarbage();
};

export const trimPurmetaCacheImpl = function() {
  if (purmetaStats !== null) purmetaStats.ram.trimCalls++;
  while (ramCacheBytes > maxRamCacheBytes && ramCache.size !== 0) {
    const oldest = ramCache.keys().next().value;
    if (purmetaStats !== null) {
      purmetaStats.ram.evictions++;
      purmetaStats.ram.evictedBytes += ramCache.get(oldest).bytes;
    }
    ramCacheBytes -= ramCache.get(oldest).bytes;
    ramCache.delete(oldest);
  }
  if (purmetaStats !== null) {
    purmetaStats.ram.boundaryPeakEntries = Math.max(purmetaStats.ram.boundaryPeakEntries, ramCache.size);
    purmetaStats.ram.boundaryPeakSerializedBytes = Math.max(purmetaStats.ram.boundaryPeakSerializedBytes, ramCacheBytes);
  }
  maybeCollectGarbage();
};

export const logMemoryImpl = function(label) {
  return function() {
    // GC is managed at module boundaries, with no forced GC here
    const mem = process.memoryUsage();
    console.log(`[Memory - ${label}] HeapUsed: ${Math.round(mem.heapUsed / 1024 / 1024)} MB | RSS: ${Math.round(mem.rss / 1024 / 1024)} MB`);
  };
};
