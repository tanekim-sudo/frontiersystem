// Simple script to check page rendering and console errors
const http = require('http');

console.log('Fetching http://localhost:5173/ ...\n');

http.get('http://localhost:5173/', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Page loaded successfully!');
    console.log('Status:', res.statusCode);
    console.log('\nHTML Content:');
    console.log(data);
    console.log('\n=== Page Check Complete ===');
    console.log('Note: The page requires a browser to execute JavaScript.');
    console.log('Please open http://localhost:5173/ in your browser to see the rendered result.');
  });
}).on('error', (err) => {
  console.error('Error fetching page:', err.message);
});
