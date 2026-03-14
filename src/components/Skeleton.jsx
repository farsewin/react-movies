import React from 'react';

export const MovieCardSkeleton = () => {
  return (
    <div className="movie-card animate-pulse">
      <div className="w-full aspect-[2/3] bg-dark-100/50 rounded-2xl mb-4" />
      <div className="h-6 bg-dark-100/80 rounded-lg w-3/4 mb-3" />
      <div className="flex items-center gap-2">
        <div className="h-4 bg-dark-100/80 rounded-lg w-1/4" />
        <div className="h-4 bg-dark-100/40 rounded-lg w-4" />
        <div className="h-4 bg-dark-100/80 rounded-lg w-1/4" />
      </div>
    </div>
  );
};

export const TrendingSkeleton = () => {
  return (
    <div className="trending animate-pulse">
      <div className="h-10 bg-dark-100/80 rounded-lg w-48 mb-8" />
      <ul className="flex gap-10 overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="min-w-[230px] flex gap-4 items-center">
            <div className="text-5xl font-black text-dark-100">0</div>
            <div className="w-[127px] h-[163px] bg-dark-100/50 rounded-xl" />
          </li>
        ))}
      </ul>
    </div>
  );
};

export const PlayerSkeleton = () => {
  return (
    <div className="w-full aspect-video bg-dark-100/50 rounded-3xl animate-pulse flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="size-16 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-light-200 font-medium">Initializing Stream...</p>
      </div>
    </div>
  );
};
