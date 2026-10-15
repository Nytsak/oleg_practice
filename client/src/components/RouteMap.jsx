import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Icon from "./Icon";
export default function RouteMap({ points = [], onPick, tracking = [] }) {
  const container = useRef(null),
    mapRef = useRef(null),
    layerRef = useRef(null),
    tileRef = useRef(null),
    pointsRef = useRef(points),
    [osm, setOsm] = useState(false);
  pointsRef.current = points;
  useEffect(() => {
    const map = L.map(container.current, {
      zoomControl: false,
      attributionControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([48.927, 24.727], 13);
    mapRef.current = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const Grid = L.GridLayer.extend({
      createTile(coords) {
        const tile = document.createElement("canvas");
        tile.width = tile.height = 256;
        const ctx = tile.getContext("2d");
        ctx.fillStyle = "#eaf0e7";
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = "#d3ded0";
        ctx.lineWidth = 1;
        for (let p = 0; p <= 256; p += 64) {
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, 256);
          ctx.moveTo(0, p);
          ctx.lineTo(256, p);
          ctx.stroke();
        }
        const ll = map.unproject(
          L.point(coords.x * 256, coords.y * 256),
          coords.z,
        );
        ctx.fillStyle = "#7b9082";
        ctx.font = "10px sans-serif";
        ctx.fillText(
          `${ll.lat.toFixed(3)}° N · ${ll.lng.toFixed(3)}° E`,
          8,
          16,
        );
        return tile;
      },
    });
    new Grid({ attribution: "Схема координат WGS 84" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => {
      if (mapRef.current !== map) return;
      map.invalidateSize({ animate: false });
      const pts = pointsRef.current;
      if (pts.length)
        map.fitBounds(
          L.latLngBounds(
            pts.map((p) => [Number(p.latitude), Number(p.longitude)]),
          ),
          { padding: [45, 45], maxZoom: 14, animate: false },
        );
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      mapRef.current = null;
      map.stop();
      map.remove();
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const listener = (e) =>
      onPick?.({
        latitude: +e.latlng.lat.toFixed(6),
        longitude: +e.latlng.lng.toFixed(6),
      });
    map.on("click", listener);
    return () => map.off("click", listener);
  }, [onPick]);
  useEffect(() => {
    const map = mapRef.current,
      layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const coords = points.map((p) => [Number(p.latitude), Number(p.longitude)]);
    if (coords.length > 1)
      L.polyline(coords, {
        color: "#256652",
        weight: 4,
        dashArray: "7 6",
      }).addTo(layer);
    points.forEach((p, i) => {
      const marker = L.marker(coords[i], {
        icon: L.divIcon({
          className: "route-marker",
          html: `<span><b style="transform:rotate(45deg)">${i + 1}</b></span>`,
          iconSize: [30, 38],
          iconAnchor: [15, 34],
        }),
      }).addTo(layer);
      const label = document.createElement("span");
      label.textContent = p.label_snapshot || p.name || `Точка ${i + 1}`;
      marker.bindTooltip(label, { direction: "top" });
    });
    if (coords.length)
      map.fitBounds(L.latLngBounds(coords), {
        padding: [45, 45],
        maxZoom: 14,
        animate: false,
      });
    const groups = new Map();
    tracking.forEach((p) => {
      const key = p.segment_id || "current";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([p.latitude, p.longitude]);
    });
    for (const list of groups.values())
      if (list.length > 1)
        L.polyline(list, { color: "#cd8c38", weight: 4 }).addTo(layer);
    if (tracking.length)
      L.circleMarker([tracking.at(-1).latitude, tracking.at(-1).longitude], {
        radius: 7,
        color: "#fff",
        weight: 3,
        fillColor: "#cd8c38",
        fillOpacity: 1,
      }).addTo(layer);
  }, [points, tracking]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (osm) {
      tileRef.current = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        },
      ).addTo(map);
    } else {
      tileRef.current?.remove();
      tileRef.current = null;
    }
  }, [osm]);
  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map"
        role="img"
        aria-label="Карта точок маршруту"
      />
      <div className="map-top">
        <span>
          <Icon name="map" size={15} />
          {osm ? "OpenStreetMap" : "Схема координат"}
        </span>
        <button onClick={() => setOsm(!osm)}>
          {osm ? "Показати схему" : "Показати OpenStreetMap"}
        </button>
      </div>
      <div className="map-note">
        {onPick
          ? "Натисніть на карту, щоб додати власну точку"
          : "Пунктир — прямі відрізки між точками"}
      </div>
    </div>
  );
}
