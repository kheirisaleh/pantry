from . import alerts, assistant, automation, ingredients, inventory, meals, recipes, reports, shopping, system

ROUTERS = [
    system.router,
    assistant.router,
    automation.router,
    ingredients.router,
    recipes.router,
    meals.router,
    inventory.router,
    shopping.router,
    alerts.router,
    reports.router,
]
