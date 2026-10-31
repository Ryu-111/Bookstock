/** 入力からハイフン・空白を除く。 */
function compact(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++)
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 978/979で始まり、チェックディジットが正しいEAN-13か。 */
export function isIsbn13(input: string): boolean {
  const code = compact(input);
  if (!/^97[89]\d{10}$/.test(code)) return false;
  return isbn13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** チェックディジットが正しいISBN-10か（末尾Xは10）。 */
export function isIsbn10(input: string): boolean {
  const code = compact(input);
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = code[i] === 'X' ? 10 : Number(code[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

/**
 * ISBN-10/13、またはISBNのJANコード（978/979）を正規化したISBN-13にする。
 * 書籍JANの2段目（192始まり）など、ISBNでない入力はnullを返す。
 */
export function toIsbn13(input: string): string | null {
  const code = compact(input);
  if (isIsbn13(code)) return code;
  if (isIsbn10(code)) {
    const first12 = `978${code.slice(0, 9)}`;
    return `${first12}${isbn13CheckDigit(first12)}`;
  }
  return null;
}
