import Foundation

/// Étape 2 (à venir) — « ✨ Créer un show ».
///
/// Idée : le modèle Apple Foundation Models (sur le Mac) produit une « recette » à partir d'une phrase
/// (couleurs, énergie, moments, tempo) ; le moteur du show la transforme ensuite en show avec l'API existante
/// (POST /api/shows). Rien n'est branché pour l'instant : le menu affiche « bientôt » et la page peut déjà appeler
/// window.ShowLumiereApp.createShow("…") (voir WebController).
struct ShowRecipe: Codable {
    var name: String
    var colors: [String]
    var energy: Double?
    var tempo: Double?
    var moments: [String]?
}

enum ShowCreatorError: LocalizedError {
    case notAvailableYet

    var errorDescription: String? { "La création de show par intelligence artificielle arrive bientôt." }
}

enum ShowCreator {
    static var isAvailable: Bool { false }

    static func recipe(from prompt: String) async throws -> ShowRecipe {
        throw ShowCreatorError.notAvailableYet
    }
}
