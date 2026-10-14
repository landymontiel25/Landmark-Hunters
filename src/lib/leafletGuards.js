import L from 'leaflet';
import 'leaflet.markercluster';

// Two Leaflet timers outlive the map they belong to. Leaving a map screen
// in the middle of either one threw an uncaught TypeError (found by the app
// simulation, docs/app-sim-results.md):
//
// - A zoom animation ends on a 250 ms timer (_onZoomTransitionEnd). If the
//   map was removed in between (tap another tab while the map is still
//   zooming to your location), the timer moves a map pane that no longer
//   exists: "Cannot read properties of undefined (reading '_leaflet_pos')".
// - MarkerClusterGroup with chunkedLoading adds markers in timed chunks. If
//   the group leaves the map between chunks, the next chunk reads the map:
//   "Cannot read properties of null (reading 'getMinZoom')".
//
// Both now stop quietly once their map is gone. Upstream: Leaflet 1.9.4,
// leaflet.markercluster 1.5.3.

const zoomEnd = L?.Map?.prototype?._onZoomTransitionEnd;
if (zoomEnd && !zoomEnd.lhGuarded) {
  const guarded = function onZoomTransitionEnd(...args) {
    if (!this._mapPane) {
      this._animatingZoom = false;
      return;
    }
    return zoomEnd.apply(this, args);
  };
  guarded.lhGuarded = true;
  L.Map.prototype._onZoomTransitionEnd = guarded;
}

const Group = L?.MarkerClusterGroup;
if (Group && !Group.prototype._addLayer.lhGuarded) {
  const addLayer = Group.prototype._addLayer;
  const guarded = function addLayerOnMap(layer, zoom) {
    // Off the map: keep it for when the group is added again, the way
    // addLayers does for a group that is not on a map.
    if (!this._map) {
      this._needsClustering?.push(layer);
      return;
    }
    return addLayer.call(this, layer, zoom);
  };
  guarded.lhGuarded = true;
  Group.prototype._addLayer = guarded;

  const Cluster = L.MarkerCluster;
  const addChildren = Cluster?.prototype._recursivelyAddChildrenToMap;
  if (addChildren && !addChildren.lhGuarded) {
    const guardedChildren = function addChildrenToMap(...args) {
      if (!this._group?._map) return;
      return addChildren.apply(this, args);
    };
    guardedChildren.lhGuarded = true;
    Cluster.prototype._recursivelyAddChildrenToMap = guardedChildren;
  }
}

export default L;
