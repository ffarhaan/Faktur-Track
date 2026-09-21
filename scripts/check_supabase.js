const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://jvybnamzibyvjftoknzz.supabase.co';
const supabaseAnonKey = 'sb_publishable_x-yWWJsyWtwIF0439FcxGw_sSV5wtAO';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkDB() {
  console.log('Testing Supabase connection...');
  try {
    const { data, count, error } = await supabase
      .from('faktur_records')
      .select('*', { count: 'exact' })
      .limit(10);
    
    if (error) {
      console.error('Supabase Query Error:', error);
      return;
    }

    console.log('Total Count in DB:', count);
    console.log('Sample Data Rows:', data ? data.length : 0);
    if (data && data.length > 0) {
      console.log('First row sample:', data[0]);
    }
  } catch(e) {
    console.error('Catch Error:', e.message);
  }
}

checkDB();
