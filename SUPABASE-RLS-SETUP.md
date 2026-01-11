# Supabase RLS Setup Instructions

## ⚠️ Важливо: Увімкніть Row Level Security

Для правильної роботи додатку потрібно налаштувати RLS policies у Supabase.

### Кроки:

1. **Увійдіть у ваш Supabase проект**
   - Перейдіть на https://supabase.com
   - Оберіть ваш проект

2. **Увімкніть RLS для таблиці `trades`**

   ```sql
   -- Enable RLS
   ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

   -- Create policy for users to see only their own trades
   CREATE POLICY "Users can see own trades" ON trades
     FOR SELECT
     USING (auth.uid() = user_id);

   -- Create policy for users to insert their own trades
   CREATE POLICY "Users can insert own trades" ON trades
     FOR INSERT
     WITH CHECK (auth.uid() = user_id);

   -- Create policy for users to update their own trades
   CREATE POLICY "Users can update own trades" ON trades
     FOR UPDATE
     USING (auth.uid() = user_id);

   -- Create policy for users to delete their own trades
   CREATE POLICY "Users can delete own trades" ON trades
     FOR DELETE
     USING (auth.uid() = user_id);
   ```

3. **Увімкніть RLS для таблиці `user_profiles`**

   ```sql
   -- Enable RLS
   ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

   -- Create policy for users to see their own profile
   CREATE POLICY "Users can see own profile" ON user_profiles
     FOR SELECT
     USING (auth.uid() = user_id);

   -- Create policy for users to update their own profile
   CREATE POLICY "Users can update own profile" ON user_profiles
     FOR UPDATE
     USING (auth.uid() = user_id);

   -- Create policy for users to insert their own profile
   CREATE POLICY "Users can insert own profile" ON user_profiles
     FOR INSERT
     WITH CHECK (auth.uid() = user_id);
   ```

4. **Перевірте що RLS увімкнено**
   - В Supabase Dashboard перейдіть до Authentication → Policies
   - Перевірте що для таблиць `trades` та `user_profiles` показуються політики

### Якщо RLS не налаштовано:
- Кнопки Update/Save/Delete можуть працювати нестабільно
- Можуть виникати помилки "row-level security error"
- Дані можуть бути доступні іншим користувачам

### SQL для виконання в Supabase:

Ви можете виконати ці SQL команди в SQL Editor у Supabase Dashboard:

```sql
-- Enable RLS on trades table
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own trades" ON trades
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable RLS on user_profiles table
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own profile" ON user_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

