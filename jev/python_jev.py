
import requests

url = "http://localhost:8888/v1/systemone"

headers = {
    "Authorization": "Bearer sk-unsloth-0bd6eb6f54ebacc7662f7c6ee564a284",
    "Content-Type": "application/json",
}

payload = {
    "model": "laya",
    "state": "Hi, I was charged twice for my March invoice (#4411). Please refund the duplicate today.",
    "questions": {
        "team": {
            "type": "choice",
            "instructions": "Which team should handle this?",
            "criteria": {
                "billing": "invoices, payments, refunds",
                "technical": "bugs, outages, errors",
                "sales": "pricing, new plans",
                "other": "everything else",
            },
        },
        "refund": {
            "type": "noul",
            "instructions": "Does the customer ask for a refund?",
        },
        "urgency": {
            "type": "score",
            "instructions": "How urgent is this?",
            "criteria": ["not urgent", "soon", "today"],
        },
    },
}

try:
    response = requests.post(
        url,
        headers=headers,
        json=payload,
        timeout=30,
    )

    print("Status code:", response.status_code)
    print("Response:")

    try:
        print(response.json())
    except requests.exceptions.JSONDecodeError:
        print(response.text)

    response.raise_for_status()

except requests.exceptions.RequestException as e:
    print("Request failed:", e)