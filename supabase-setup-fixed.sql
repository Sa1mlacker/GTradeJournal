-- G Trade Journal - Supabase Database Setup (FIXED)
-- Виконайте цей скрипт у вашому Supabase проекті (SQL Editor)

-- 1. Створити таблицю trades (трейди користувачів)
CREATE TABLE IF NOT EXISTS trades (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    asset TEXT NOT NULL,
    date DATE NOT NULL,
    session TEXT NOT NULL,
    direction TEXT NOT NULL,
    setup TEXT,
    risk TEXT NOT NULL,
    rr NUMERIC,
    pl TEXT,
    result TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Створити таблицю user_profiles (налаштування користувачів)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Індекси для швидкого пошуку
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_public ON user_profiles(is_public);

-- 4. Row Level Security (RLS) - безпека на рівні рядків

-- Увімкнути RLS для таблиці trades
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Видалити старі політики якщо є
DROP POLICY IF EXISTS "Users can read own trades" ON trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON trades;
DROP POLICY IF EXISTS "Users can update own trades" ON trades;
DROP POLICY IF EXISTS "Users can delete own trades" ON trades;
DROP POLICY IF EXISTS "Public read access to trades of public users" ON trades;

-- Політика: користувач може читати тільки свої трейди
CREATE POLICY "Users can read own trades"
ON trades FOR SELECT
USING (auth.uid() = user_id);

-- Політика: користувач може вставляти тільки свої трейди
CREATE POLICY "Users can insert own trades"
ON trades FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Політика: користувач може оновлювати тільки свої трейди
CREATE POLICY "Users can update own trades"
ON trades FOR UPDATE
USING (auth.uid() = user_id);

-- Політика: користувач може видаляти тільки свої трейди
CREATE POLICY "Users can delete own trades"
ON trades FOR DELETE
USING (auth.uid() = user_id);

-- Політика: публічний доступ до трейдів користувачів з увімкненим is_public
CREATE POLICY "Public read access to trades of public users"
ON trades FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM user_profiles
        WHERE user_profiles.user_id = trades.user_id
        AND user_profiles.is_public = TRUE
    )
);

-- Увімкнути RLS для таблиці user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Видалити старі політики якщо є
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Anonymous can read public profiles" ON user_profiles;

-- Політика: користувач може читати свій профіль
CREATE POLICY "Users can read own profile"
ON user_profiles FOR SELECT
USING (auth.uid() = user_id);

-- Політика: користувач може вставляти свій профіль
CREATE POLICY "Users can insert own profile"
ON user_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Політика: користувач може оновлювати свій профіль
CREATE POLICY "Users can update own profile"
ON user_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- Політика: анонімні користувачі можуть читати публічні профілі (для перевірки is_public)
CREATE POLICY "Anonymous can read public profiles"
ON user_profiles FOR SELECT
USING (is_public = TRUE);

-- 5. Функція для автоматичного оновлення updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Тригер для автоматичного оновлення updated_at у user_profiles
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON user_profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Готово! База даних налаштована для G Trade Journal
--
-- ВАЖЛИВО: Тригер для автоматичного створення профілю видалено
-- Профіль буде створюватися автоматично в додатку при першому вході
