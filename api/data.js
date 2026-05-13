// File: api/data.js

// Fungsi ini akan dieksekusi oleh server Vercel, bukan oleh browser.
export default async function handler(request, response) {
    // Mengambil "rahasia" dari Environment Variables yang sudah kita set di Vercel
    const apiKey = process.env.JSONBIN_API_KEY;
    const binId = process.env.JSONBIN_BIN_ID;
    const jsonBinUrl = `https://api.jsonbin.io/v3/b/${binId}`;

    // Cek metode request: GET untuk mengambil data, PUT untuk menyimpan data
    if (request.method === 'GET') {
        try {
            // Mengambil versi terbaru dari data di JSONBin
            const apiResponse = await fetch(`${jsonBinUrl}/latest`, {
                headers: { 'X-Master-Key': apiKey }
            });

            if (!apiResponse.ok) {
                // Jika gagal, kirim status error
                return response.status(apiResponse.status).json({ message: 'Error fetching data from JSONBin.' });
            }

            const data = await apiResponse.json();
            // Kirim data kembali ke frontend (script.js)
            response.status(200).json(data.record);

        } catch (error) {
            response.status(500).json({ message: 'Internal Server Error' });
        }
    } else if (request.method === 'PUT') {
        try {
            // Mengupdate data di JSONBin dengan data baru dari frontend
            const apiResponse = await fetch(jsonBinUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Key': apiKey
                },
                // request.body adalah data yang dikirim dari script.js
                body: JSON.stringify(request.body) 
            });

            if (!apiResponse.ok) {
                return response.status(apiResponse.status).json({ message: 'Error updating data in JSONBin.' });
            }

            // Kirim konfirmasi sukses kembali ke frontend
            response.status(200).json({ success: true });

        } catch (error) {
            response.status(500).json({ message: 'Internal Server Error' });
        }
    } else {
        // Jika metodenya bukan GET atau PUT
        response.setHeader('Allow', ['GET', 'PUT']);
        response.status(405).end(`Method ${request.method} Not Allowed`);
    }
}
