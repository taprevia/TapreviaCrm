import React from 'react';
import { Star } from 'lucide-react';

interface StarRatingProps {
  rating?: number;
  count?: number;
  showCount?: boolean;
  size?: number;
}

export const StarRating: React.FC<StarRatingProps> = ({
  rating = 5,
  count,
  showCount = true,
  size = 14,
}) => {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            size={size}
            className={i < Math.floor(rating) ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-200'}
          />
        ))}
      </div>
      {showCount && count !== undefined && (
        <span className="text-xs text-gray-500 font-medium">({count} reviews)</span>
      )}
    </div>
  );
};
