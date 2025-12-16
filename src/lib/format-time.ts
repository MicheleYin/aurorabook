export const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) {
      value = 0;
    }
    const totalSeconds = Math.floor(value);
    
    // Calculate months (assuming 30 days per month for simplicity)
    const secondsPerMonth = 30 * 24 * 3600;
    const months = Math.floor(totalSeconds / secondsPerMonth);
    const remainingAfterMonths = totalSeconds % secondsPerMonth;
    
    // Calculate days
    const secondsPerDay = 24 * 3600;
    const days = Math.floor(remainingAfterMonths / secondsPerDay);
    const remainingAfterDays = remainingAfterMonths % secondsPerDay;
    
    // Calculate hours, minutes, seconds
    const hours = Math.floor(remainingAfterDays / 3600);
    const minutes = Math.floor((remainingAfterDays % 3600) / 60);
    const seconds = remainingAfterDays % 60;
    
    // Build the formatted string
    const parts: string[] = [];
    
    if (months > 0) {
      parts.push(`${months}mo`);
    }
    if (days > 0) {
      parts.push(`${days}d`);
    }
    
    // Format time portion
    if (hours > 0 || months > 0 || days > 0) {
      // Show full H:MM:SS format when we have days/months or hours
      parts.push(`${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
    } else {
      // Show M:SS format for durations under an hour
      parts.push(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    }
    
    return parts.join(" ");
  };