// API（PATCH /api/settings）と同じ規則: 1〜8 段階、各 1〜365 の整数、前より大きい日数
export function validateIntervals(values: string[]): string | null {
  if (values.length < 1 || values.length > 8) return "段階は 1〜8 個にしてください";
  const nums = values.map((v) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) return "日数は 1〜365 の整数で入力してください";
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) return "日数は前の段階より大きくしてください";
  }
  return null;
}
