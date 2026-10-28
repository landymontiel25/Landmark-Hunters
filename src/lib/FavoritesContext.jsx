import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { addFavorite, favoriteId, removeFavorite, setFavoriteNote, subscribeFavorites } from './favorites';

// One live listener on the signed-in user's favorites, shared by every
// bookmark button, the landmark page and the Favorite places screen.
const NONE = {
  favorites: [],
  ready: true,
  signedIn: false,
  isFavorite: () => false,
  getFavorite: () => null,
  add: async () => {},
  remove: async () => {},
  setNote: async () => {},
};
const FavoritesContext = createContext(NONE);

export function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [favorites, setFavorites] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFavorites([]);
    setReady(!uid);
    if (!uid) return undefined;
    return subscribeFavorites(
      uid,
      (rows) => {
        setFavorites(rows);
        setReady(true);
      },
      () => setReady(true)
    );
  }, [uid]);

  const byKey = useMemo(() => new Map(favorites.map((f) => [favoriteId(f.region, f.id), f])), [favorites]);
  const getFavorite = useCallback((region, id) => byKey.get(favoriteId(region, id)) || null, [byKey]);

  const value = useMemo(
    () => ({
      favorites,
      ready,
      signedIn: !!uid,
      isFavorite: (region, id) => byKey.has(favoriteId(region, id)),
      getFavorite,
      add: (place) => addFavorite(uid, place),
      remove: (region, id) => removeFavorite(uid, region, id),
      setNote: (region, id, note) => setFavoriteNote(uid, region, id, note),
    }),
    [favorites, ready, uid, byKey, getFavorite]
  );
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export const useFavorites = () => useContext(FavoritesContext);
