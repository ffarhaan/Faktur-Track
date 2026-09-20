const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const downloadsDir = 'C:\\Users\\medikabinainvestama_\\Downloads';
const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.xlsx'));

files.forEach(file => {
  try {
    const filePath = path.join(downloadsDir, file);
    const wb = XLSX.readFile(filePath);
    wb.SheetNames.forEach(sheet => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 });
      rows.forEach((r, idx) => {
        const line = JSON.stringify(r);
        if (
          line.includes('1803') || 
          line.includes('9279') || 
          line.includes('13328') ||
          line.toUpperCase().includes('PROCOLD') || 
          line.toUpperCase().includes('OBH COMBI')
        ) {
          console.log(`[${file} :: ${sheet}] Row ${idx}: ${line}`);
        }
      });
    });
  } catch(e) {
    console.error(`Error reading ${file}:`, e.message);
  }
});
