// FFI JavaScript de `NativeMaps` : les entrées à comparateur natif n'existent
// que pour le backend Go. En JS, elles retombent sur `Data.Map.Internal` avec
// l'instance `Ord` correspondante (passée par l'appelant pour `EvalRef`/
// `TcoRef`, afin d'éviter un cycle d'imports avec Semantics/Tco).
import * as CoreFn from '../PureScript.Backend.Optimizer.CoreFn/index.js';
import * as DataOrd from '../Data.Ord/index.js';
import * as DataMapInternal from '../Data.Map.Internal/index.js';

let qualifiedIdentOrdCache = null;

function qualifiedIdentOrd() {
    if (qualifiedIdentOrdCache === null) {
        qualifiedIdentOrdCache = CoreFn.ordQualified(DataOrd.ordString);
    }
    return qualifiedIdentOrdCache;
}

export const qualifiedIdentCompare = null;
export const stringCompare = null;

export const lookupQualifiedIdentImpl = (_compare) => (key) => (map) =>
    DataMapInternal.lookup(qualifiedIdentOrd())(key)(map);

export const insertQualifiedIdentImpl = (_compare) => (key) => (value) => (map) =>
    DataMapInternal.insert(qualifiedIdentOrd())(key)(value)(map);

export const lookupStringImpl = (_compare) => (key) => (map) =>
    DataMapInternal.lookup(DataOrd.ordString)(key)(map);

export const insertStringImpl = (_compare) => (key) => (value) => (map) =>
    DataMapInternal.insert(DataOrd.ordString)(key)(value)(map);

export const unionStringImpl = (_compare) => (m1) => (m2) =>
    DataMapInternal.union(DataOrd.ordString)(m1)(m2);

export const unionWithStringImpl = (_compare) => (f) => (m1) => (m2) =>
    DataMapInternal.unionWith(DataOrd.ordString)(f)(m1)(m2);

export const intCompare = null;

export const lookupIntImpl = (_compare) => (key) => (map) =>
    DataMapInternal.lookup(DataOrd.ordInt)(key)(map);

export const insertIntImpl = (_compare) => (key) => (value) => (map) =>
    DataMapInternal.insert(DataOrd.ordInt)(key)(value)(map);

export const unionWithIntImpl = (_compare) => (f) => (m1) => (m2) =>
    DataMapInternal.unionWith(DataOrd.ordInt)(f)(m1)(m2);

export const evalRefCompare = null;

export const lookupEvalRefImpl = (_compare) => (dictCompare) => (key) => (map) =>
    DataMapInternal.lookup({ compare: dictCompare })(key)(map);

export const insertEvalRefImpl = (_compare) => (dictCompare) => (key) => (value) => (map) =>
    DataMapInternal.insert({ compare: dictCompare })(key)(value)(map);

export const memberEvalRefImpl = (_compare) => (dictCompare) => (key) => (map) =>
    DataMapInternal.member({ compare: dictCompare })(key)(map);

export const tcoRefCompare = null;

export const unionWithTcoRefImpl = (_compare) => (dictCompare) => (f) => (m1) => (m2) =>
    DataMapInternal.unionWith({ compare: dictCompare })(f)(m1)(m2);
