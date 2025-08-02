
const keys = [
    {
        key: "fc68ccbb-086d-4e0f-8f65-3a4294f5a7b0",
        owner: "User",
        active: true,
        buckets: [
            {
                name: "oreka",
                all: true
            },
        ]
    },
    {
        key: "a47eba90-eca4-4a73-9bf1-d5461b28e3f0",
        owner: "User",
        active: true,
        buckets: [
            {
                name: "food",
                all: true,
            }
        ]
    }
]

const APIKeyAuth = async (req, res, next) => {
    const key = req.get("x-api-key")

    console.log(req)

    if (!key)
        return res.status(401).json({ message: 'Invalid or missing API key' });

    const record = keys.find(k => k.key === key && k.active)

    if (!record)
        return res.status(401).json({ message: 'Invalid or inactive API key' });
    
    req.apiKey = record
    next();
}

module.exports = APIKeyAuth